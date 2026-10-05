/** Jest 配置：ts-jest，测试独立使用 test.db，避免污染演示库 */
module.exports = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  rootDir: 'test',
  testTimeout: 30000,
};
