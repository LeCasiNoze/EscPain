import crypto from "node:crypto";

export function genPublicCode(len = 6) {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let out = "";
  for (let i = 0; i < len; i++) out += alphabet[Math.floor(Math.random() * alphabet.length)];
  return out;
}

export function genEditToken() {
  return crypto.randomBytes(24).toString("base64url");
}

export function sha256(s: string) {
  return crypto.createHash("sha256").update(s).digest("hex");
}
