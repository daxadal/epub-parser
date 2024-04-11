module.exports = {
  reporters: ["default", "jest-junit"],

  roots: ["test"],
  testMatch: ["**/?(*.)+(spec|test).+(ts|js)"],
  transform: {
    "^.+\\.(ts|js)$": "ts-jest",
  },
  testTimeout: 10000,
  testEnvironment: "node",
};
