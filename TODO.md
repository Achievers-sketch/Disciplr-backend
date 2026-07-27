# Fix: toPublicVault throws on real DB vault rows

## Steps

- [x] Step 0: Analyze issue and gather context (completed)
- [x] Step 1: Confirm plan with user (completed)
- [ ] Step 2: Update `src/utils/mappers.ts` — fix `toPublicVault` to read DB column names (`creator`, `end_date`)
- [ ] Step 3: Update `src/tests/mappers.test.ts` — fix `makeVault` fixture and assertions to match DB row shape
- [ ] Step 4: Run tests to verify the fix

