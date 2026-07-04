export function normalizeUsername(value: string) {
  return value.trim().toLowerCase();
}

export function validateUsername(value: string) {
  const username = normalizeUsername(value);
  if (!/^[a-z0-9_]{3,24}$/.test(username)) throw new Error("Use 3–24 lowercase letters, numbers, or underscores.");
  return username;
}

export function validatePassword(value: string) {
  if (value.length < 12) throw new Error("Use at least 12 characters for your password.");
  if (value.length > 128) throw new Error("Password must be 128 characters or fewer.");
  return value;
}
