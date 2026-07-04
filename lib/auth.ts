import type { User } from "@supabase/supabase-js";
import { generateIdentity, unlockIdentity } from "./crypto";
import { assertPseudonymAuthReady, getSupabase } from "./supabase";
import type { PublicProfile } from "./types";
import { validatePassword, validateUsername } from "./validation";

export { normalizeUsername, validatePassword, validateUsername } from "./validation";

export type UnlockedAccount = {
  user: User;
  profile: PublicProfile;
  privateKey: CryptoKey;
};

function usernameEmail(username: string) {
  return `${username}@users.whispr.local`;
}

async function loadAndUnlock(user: User, password: string): Promise<UnlockedAccount> {
  const supabase = getSupabase();
  const [{ data: profile, error: profileError }, { data: vault, error: vaultError }] = await Promise.all([
    supabase.from("profiles").select("id, username, public_key, created_at").eq("id", user.id).single(),
    supabase.from("key_vaults").select("encrypted_private_key, private_key_iv, private_key_salt").eq("user_id", user.id).single(),
  ]);
  if (profileError || !profile) throw new Error(profileError?.message ?? "Your public profile is missing.");
  if (vaultError || !vault) throw new Error(vaultError?.message ?? "Your encrypted key backup is missing.");
  const privateKey = await unlockIdentity(password, vault.encrypted_private_key, vault.private_key_iv, vault.private_key_salt);
  return { user, profile: { ...profile, public_key: profile.public_key as JsonWebKey }, privateKey };
}

export async function createAccount(usernameInput: string, passwordInput: string) {
  const username = validateUsername(usernameInput);
  const password = validatePassword(passwordInput);
  await assertPseudonymAuthReady();
  const identity = await generateIdentity(password);
  const supabase = getSupabase();
  const { data, error } = await supabase.auth.signUp({
    email: usernameEmail(username),
    password,
    options: {
      data: {
        username,
        public_key: identity.publicKey,
        encrypted_private_key: identity.encryptedPrivateKey,
        private_key_iv: identity.privateKeyIv,
        private_key_salt: identity.privateKeySalt,
        key_version: 1,
      },
    },
  });
  if (error) {
    if (error.message.toLowerCase().includes("database")) throw new Error("That pseudonym is already taken.");
    throw error;
  }
  if (!data.user || !data.session) throw new Error("Account created, but sign-in is waiting for email confirmation. Disable email confirmation in Supabase Auth because Whispr uses pseudonyms without inboxes.");
  return { user: data.user, profile: { id: data.user.id, username, public_key: identity.publicKey }, privateKey: identity.privateKey } satisfies UnlockedAccount;
}

export async function signIn(usernameInput: string, password: string) {
  const username = validateUsername(usernameInput);
  const supabase = getSupabase();
  const { data, error } = await supabase.auth.signInWithPassword({ email: usernameEmail(username), password });
  if (error || !data.user) throw new Error("Incorrect pseudonym or password.");
  try {
    return await loadAndUnlock(data.user, password);
  } catch (error) {
    await supabase.auth.signOut();
    throw error;
  }
}

export async function restoreAccount(username: string, password: string) {
  return signIn(username, password);
}

export async function signOut() {
  await getSupabase().auth.signOut();
}
