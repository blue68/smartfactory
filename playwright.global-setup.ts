export default async () => {
  // Remove Vitest's global expect to avoid conflict with Playwright's expect
  delete (globalThis as any).expect;
};