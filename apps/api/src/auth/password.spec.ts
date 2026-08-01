import { hashPassword, verifyPassword } from "@hh/auth";

describe("password hashing (argon2id)", () => {
  jest.setTimeout(30_000); // 64 MiB memoryCost hashes are deliberately slow

  it("verifies a correct password and rejects a wrong one", async () => {
    const hash = await hashPassword("correct horse 9 battery");
    expect(hash).toMatch(/^\$argon2id\$/);
    await expect(verifyPassword(hash, "correct horse 9 battery")).resolves.toBe(true);
    await expect(verifyPassword(hash, "wrong password 1")).resolves.toBe(false);
  });

  it("treats malformed stored hashes as a mismatch instead of throwing", async () => {
    await expect(verifyPassword("not-a-hash", "whatever1")).resolves.toBe(false);
    await expect(verifyPassword("", "whatever1")).resolves.toBe(false);
  });
});
