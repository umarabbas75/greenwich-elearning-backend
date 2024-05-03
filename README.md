## docker compose up dev-db -d

## add .env

## nvm use 20

## yarn

## yarn start:dev

# DB Migrations

- switch to dev db
  npx prisma migrate dev
- switch prod db  
  npx prisma db push
  npx prisma migrate resolve --applied 20240224101001_update_quiz_model
  npx prisma migrate deploy

```
greenwich-elearning-backend
├─ .eslintrc.js
├─ .git
│  ├─ COMMIT_EDITMSG
│  ├─ FETCH_HEAD
│  ├─ HEAD
│  ├─ ORIG_HEAD
│  ├─ config
│  ├─ description
│  ├─ hooks
│  │  ├─ applypatch-msg.sample
│  │  ├─ commit-msg.sample
│  │  ├─ fsmonitor-watchman.sample
│  │  ├─ post-update.sample
│  │  ├─ pre-applypatch.sample
│  │  ├─ pre-commit.sample
│  │  ├─ pre-merge-commit.sample
│  │  ├─ pre-push.sample
│  │  ├─ pre-rebase.sample
│  │  ├─ pre-receive.sample
│  │  ├─ prepare-commit-msg.sample
│  │  ├─ push-to-checkout.sample
│  │  └─ update.sample
│  ├─ index
│  ├─ info
│  │  └─ exclude
│  ├─ logs
│  │  ├─ HEAD
│  │  └─ refs
│  │     ├─ heads
│  │     │  ├─ main
│  │     │  ├─ master
│  │     │  └─ master-dev
│  │     └─ remotes
│  │        └─ origin
│  │           ├─ HEAD
│  │           ├─ master
│  │           └─ master-dev
│  ├─ packed-refs
│  └─ refs
│     ├─ heads
│     │  ├─ main
│     │  ├─ master
│     │  └─ master-dev
│     ├─ remotes
│     │  └─ origin
│     │     ├─ HEAD
│     │     ├─ master
│     │     └─ master-dev
│     └─ tags
├─ .gitignore
├─ .prettierrc
├─ README.md
├─ docker-compose.yml
├─ nest-cli.json
├─ package.json
├─ prisma
│  ├─ migrations
│  │  ├─ 20240430103808_initial_migration
│  │  │  └─ migration.sql
│  │  └─ migration_lock.toml
│  └─ schema.prisma
├─ src
│  ├─ app.module.ts
│  ├─ auth
│  │  ├─ auth.controller.ts
│  │  ├─ auth.module.ts
│  │  └─ auth.service.ts
│  ├─ course
│  │  ├─ course.controller.ts
│  │  ├─ course.module.ts
│  │  └─ course.service.ts
│  ├─ decorator
│  │  └─ index.ts
│  ├─ dto.ts
│  ├─ forum-comment
│  │  ├─ forum-comment.controller.ts
│  │  ├─ forum-comment.module.ts
│  │  └─ forum-comment.service.ts
│  ├─ forum-thread
│  │  ├─ forum-thread.controller.ts
│  │  ├─ forum-thread.service.ts
│  │  └─ forum.module.ts
│  ├─ main.ts
│  ├─ prisma
│  │  ├─ prisma.module.ts
│  │  └─ prisma.service.ts
│  ├─ quiz
│  │  ├─ quiz.controller.ts
│  │  ├─ quiz.module.ts
│  │  └─ quiz.service.ts
│  ├─ strategy
│  │  ├─ index.ts
│  │  └─ jwt.strategy.ts
│  └─ user
│     ├─ user.controller.ts
│     ├─ user.module.ts
│     └─ user.service.ts
├─ test
│  ├─ app.e2e-spec.ts
│  └─ jest-e2e.json
├─ tsconfig.build.json
├─ tsconfig.json
├─ vercel.json
└─ yarn.lock

```
