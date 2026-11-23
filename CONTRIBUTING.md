# Contributing

This project is shared **as-is** and is not actively maintained for custom feature or bank-format requests. However, **Pull Requests from forks are welcome!**

If you want to tailor the tool for your own statements or add a new built-in parser:

1. **Fork this repository** and create a feature branch.
2. Make your changes and test them locally.
3. **Open a Pull Request** back to `main` if you'd like to share your improvement with others.

## Privacy First
- **Never commit real financial statements** or personal information (names, addresses, account numbers, real transaction histories).
- Place any local testing files inside `samples/do-not-commit/` (already ignored by `.gitignore`).
- All fixtures added to `samples/` or `tests/` must be 100% synthetic and anonymized.

## Adding a New Built-in Statement Parser (Tier 1)
1. Create a new parser module in `src/parsers/tier1/` implementing `StatementParser` (`id`, `name`, `canParse(input) -> number`, `parse(input, context)`).
2. Register the parser in `src/parsers/pipeline.ts`.
3. Add a synthetic test fixture in `samples/` and unit tests in `tests/parsers.test.ts`.
4. Run `npm run typecheck && npm test && npm run build` before opening a Pull Request.
