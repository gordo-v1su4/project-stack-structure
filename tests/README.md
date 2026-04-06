# Test Structure

## Layout
- `tests/unit/` — pure logic tests
- `tests/integration/` — contract and fixture discovery tests
- `tests/helpers/` — shared helpers and fake data builders
- `tests/fixtures/` — committed lightweight synthetic fixtures or expected outputs

## Local media fixtures
Heavy local media should live outside version control in:

```text
.local-fixtures/media/
```

Tests can also use `TEST_MEDIA_DIR=/absolute/path/to/media`.

## Current expectation
The fixture lane should contain at least:
- one audio file
- one video file

The current Bun-based tests do not decode real media yet; they verify discovery, structure, and core studio logic first.


## Probe command
Use the local fixture lane to generate a canonical probe manifest:

```bash
bun run probe:media
```
