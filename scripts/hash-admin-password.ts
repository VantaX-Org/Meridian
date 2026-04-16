#!/usr/bin/env ts-node
/**
 * Helper script to generate PBKDF2 password hashes for Meridian licence worker admins.
 * Task 09: Use this script during onboarding or password resets.
 * 
 * Usage:
 *   npx ts-node scripts/hash-admin-password.ts
 *   
 * Then paste your password when prompted. The script will output the salt and hash
 * to insert into the admins table.
 */

import * as readline from "readline";

const ITERATIONS = 100000;
const HASH_ALGORITHM = "SHA-256";
const SALT_BYTES = 32;
const KEY_LENGTH = 32;

const rl = readline.createInterface({
	input: process.stdin,
	output: process.stdout,
});

function generateSalt(): Buffer {
	return require("crypto").randomBytes(SALT_BYTES);
}

async function hashPassword(password: string, salt?: Buffer): Promise<{ hash: string; salt: string }> {
	const { pbkdf2 } = require("crypto");
	const saltToUse = salt || generateSalt();

	return new Promise((resolve, reject) => {
		pbkdf2(password, saltToUse, ITERATIONS, KEY_LENGTH, HASH_ALGORITHM.toLowerCase(), (err: Error | null, derivedKey: Buffer) => {
			if (err) reject(err);
			else
				resolve({
					hash: derivedKey.toString("hex"),
					salt: saltToUse.toString("hex"),
				});
		});
	});
}

async function main() {
	console.log("🔐 Meridian Licence Worker — Password Hash Generator (PBKDF2-SHA256)");
	console.log(`   Iterations: ${ITERATIONS.toLocaleString()}`);
	console.log(`   Algorithm: ${HASH_ALGORITHM}`);
	console.log("");

	rl.question("Enter email: ", async (email: string) => {
		rl.question("Enter password: ", async (password: string) => {
			try {
				const { hash, salt } = await hashPassword(password);

				console.log("\n✅ Password hashed successfully!");
				console.log("\n📋 Insert into admins table:");
				console.log("---");
				console.log(`INSERT INTO admins (email, password_hash, password_salt, role, is_active)`);
				console.log(`VALUES ('${email}', '${hash}', '${salt}', 'admin', 1);`);
				console.log("---\n");

				console.log("📊 Hash details:");
				console.log(`   Email:         ${email}`);
				console.log(`   Hash (hex):    ${hash}`);
				console.log(`   Salt (hex):    ${salt}`);
				console.log(`   Hash length:   ${hash.length} chars`);
				console.log(`   Salt length:   ${salt.length} chars\n`);
			} catch (err) {
				console.error("❌ Error hashing password:", err);
			} finally {
				rl.close();
			}
		});
	});
}

main().catch(console.error);
