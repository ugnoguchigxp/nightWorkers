import '@testing-library/jest-dom';
import { cleanup } from '@testing-library/react';
import { afterEach } from 'vitest';

// 毎回のテスト後にクリーンアップを行う
afterEach(() => {
  cleanup();
});
