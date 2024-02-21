module.exports = {
  reporters: ["default", "jest-junit"],

  roots: ["src"],
  testMatch: ["**/?(*.)+(spec|test).+(ts|js)"],
  transform: {
    "^.+\\.(ts|js)$": "ts-jest",
  },
  testTimeout: 10000,
};
