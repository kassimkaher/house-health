/** Unit tests only; integration tests use jest.integration.config.js. */
module.exports = {
  preset: "ts-jest",
  testEnvironment: "node",
  rootDir: "src",
  testRegex: ".*\\.spec\\.ts$",
  passWithNoTests: true,
};
