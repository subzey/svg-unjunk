# Tests

## How to run

Tests are only working after the build. Run once:

```sh
npm run build
```

Then run tests:

```sh
npm test
```

## How to add new test cases

Add files that end with `.input.svg` and `.expected.svg`. Ex: `foo.input.svg` and `foo.expected.svg`.

If you need to handle the lossless mode separately add `.expected-lossless.svg` as well.

All newlines and indentation in `.expected.svg` and `.expected-lossless.svg` is removed so keep it readable!

Test cases named `.throws.txt` should throw and have no expected output.

A `config` processing instruction can be used to disable lossless test entirely: add `<?config skip-lossless ?>` to the very start.
