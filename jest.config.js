module.exports = {
  reporters: ["default", "jest-junit"],

  roots: ["test"],
  testMatch: ["**/?(*.)+(spec|test).+(ts|js)"],
  transform: {
    "^.+\\.(ts|js)$": "ts-jest",
  },
  testTimeout: 8000,
  testEnvironment: "node",
};
