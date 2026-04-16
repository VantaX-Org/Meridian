/**
 * PBKDF2 password hashing utilities for Meridian licence worker.
 * Task 09: Replaces plaintext and weak hashing with PBKDF2 (100k iterations).
 * 
 * Uses Cloudflare Workers' native crypto APIs (no external dependencies).
 */

const ITERATIONS = 100000; // NIST recommendation for PBKDF2
const HASH_ALGORITHM = "SHA-256";
const SALT_BYTES = 32;
const KEY_LENGTH = 32;

/**
 * Generate a random salt for PBKDF2.
 */
export function generateSalt(): string {
	const saltBuffer = crypto.getRandomValues(new Uint8Array(SALT_BYTES));
	return bufferToHex(saltBuffer);
}

/**
 * Hash a password using PBKDF2-SHA256 with 100k iterations.
 *
 * @param password - The plaintext password
 * @param salt - The salt (hex string). If omitted, a random salt is generated.
 * @returns Object with hashed password and salt (both hex strings)
 */
export async function hashPassword(
	password: string,
	salt?: string
): Promise<{ hash: string; salt: string }> {
	const saltToUse = salt || generateSalt();
	const saltBuffer = hexToBuffer(saltToUse);

	const passwordBuffer = new TextEncoder().encode(password);

	const keyBuffer = await crypto.subtle.deriveKey(
		{
			name: "PBKDF2",
			salt: saltBuffer,
			hash: HASH_ALGORITHM,
			iterations: ITERATIONS,
		},
		await crypto.subtle.importKey("raw", passwordBuffer, "PBKDF2", false, ["deriveKey"]),
		{ name: "AES-GCM", length: KEY_LENGTH * 8 },
		true,
		["encrypt"]
	);

	// Export the key as raw bytes, then convert to hex
	const exportedKey = await crypto.subtle.exportKey("raw", keyBuffer);
	const hashHex = bufferToHex(new Uint8Array(exportedKey));

	return { hash: hashHex, salt: saltToUse };
}

/**
 * Verify a password against a PBKDF2 hash using constant-time comparison.
 * Prevents timing attacks on password comparison.
 *
 * @param password - The plaintext password to verify
 * @param hash - The stored PBKDF2 hash (hex string)
 * @param salt - The stored salt (hex string)
 * @returns true if password matches hash; false otherwise
 */
export async function verifyPassword(password: string, hash: string, salt: string): Promise<boolean> {
	const { hash: computedHash } = await hashPassword(password, salt);
	return constantTimeCompare(computedHash, hash);
}

/**
 * Constant-time string comparison to prevent timing attacks.
 * Compares all characters regardless of match status.
 */
function constantTimeCompare(a: string, b: string): boolean {
	if (a.length !== b.length) return false;

	let result = 0;
	for (let i = 0; i < a.length; i++) {
		result |= a.charCodeAt(i) ^ b.charCodeAt(i);
	}
	return result === 0;
}

/**
 * Convert a Uint8Array buffer to hex string.
 */
function bufferToHex(buffer: Uint8Array): string {
	return Array.from(buffer)
		.map((b) => b.toString(16).padStart(2, "0"))
		.join("");
}

/**
 * Convert a hex string to Uint8Array buffer.
 */
function hexToBuffer(hex: string): Uint8Array {
	const bytes = new Uint8Array(hex.length / 2);
	for (let i = 0; i < hex.length; i += 2) {
		bytes[i / 2] = parseInt(hex.substr(i, 2), 16);
	}
	return bytes;
}
