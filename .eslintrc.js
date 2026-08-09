module.exports = {
  parser: '@typescript-eslint/parser',
  parserOptions: {
    project: 'tsconfig.json',
    tsconfigRootDir: __dirname,
    sourceType: 'module',
  },
  plugins: ['@typescript-eslint/eslint-plugin'],
  extends: [
    'plugin:@typescript-eslint/recommended',
    'plugin:prettier/recommended',
  ],
  root: true,
  env: {
    node: true,
    jest: true,
  },
  ignorePatterns: ['.eslintrc.js'],
  rules: {
    '@typescript-eslint/interface-name-prefix': 'off',
    '@typescript-eslint/explicit-function-return-type': 'off',
    '@typescript-eslint/explicit-module-boundary-types': 'off',
    '@typescript-eslint/no-explicit-any': 'off',
  },
  overrides: [
    {
      // Learner progress percentage must come from ONE place.
      //
      // Every percentage bug this codebase has hit came from a call site
      // assembling the ratio itself and picking its own numerator/denominator
      // scope — a live-filtered numerator over a frozen manifest denominator
      // reads 92% for a learner the completion gate considers done. The fix is
      // not "remember to filter correctly", it is "never divide these here":
      // computeLearnerPercentages derives both halves from one curriculum view,
      // so the mismatch is unrepresentable.
      //
      // This rule catches the shape of that mistake — dividing a
      // UserCourseProgress count by a section total. It is a tripwire, not a
      // proof: it cannot see every way to express the same arithmetic. If it
      // fires on legitimate code, prefer routing through the engine over
      // disabling it.
      files: ['src/**/*.ts'],
      excludedFiles: [
        'src/course-version/learner-percentage.ts',
        '**/*.spec.ts',
      ],
      rules: {
        'no-restricted-syntax': [
          'error',
          {
            selector:
              'BinaryExpression[operator="/"] > MemberExpression.left[property.name=/^(UserCourseProgress|userCourseProgress)$/]',
            message:
              'Do not compute a progress percentage here. Use computeLearnerPercentages() from src/course-version/learner-percentage.ts — it derives numerator and denominator from one curriculum view so they cannot disagree.',
          },
          {
            selector:
              'BinaryExpression[operator="/"][right.property.name=/^(sectionCount|totalSections|sectionsCount)$/]',
            message:
              'Do not divide by a section total to build a percentage. Use computeLearnerPercentages() from src/course-version/learner-percentage.ts.',
          },
        ],
      },
    },
  ],
};
