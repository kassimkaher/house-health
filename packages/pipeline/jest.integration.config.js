module.exports = {
  preset: "ts-jest",
  testEnvironment: "node",
  rootDir: "test",
  testRegex: ".*\\.integration\\.spec\\.ts$",
  passWithNoTests: true,
  testTimeout: 60000,
};
