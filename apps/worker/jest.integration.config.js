/** Integration tests — require the compose.test.yml stack (see scripts/test-integration.sh). */
module.exports = {
  preset: "ts-jest",
  testEnvironment: "node",
  rootDir: "test",
  testRegex: ".*\\.integration\\.spec\\.ts$",
  passWithNoTests: true,
  testTimeout: 30000,
};
