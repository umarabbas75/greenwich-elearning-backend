## docker compose up dev-db -d

## add .env

## nvm use 20

## yarn

## npx prisma migrate dev

## yarn start:dev

# DB Migrations

- switch to dev db
npx prisma migrate dev
- switch prod db  
npx prisma migrate resolve --applied 20240224101001_update_quiz_model
npx prisma migrate deploy
