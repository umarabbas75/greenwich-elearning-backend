import { Sequelize } from 'sequelize-typescript';
import * as dotenv from 'dotenv';
import {DataTypes} from "sequelize";
dotenv.config();

export const sequelize = new Sequelize(process.env.DB_URL, {dialect: 'postgres',
protocol: 'postgres',
dialectOptions: {
  ssl: {
    require: 'true'
  }
}
});


export const Transaction = sequelize.define("transactions", {
    investment: DataTypes.DECIMAL,
    transactionHash:DataTypes.TEXT,
    address: DataTypes.TEXT,
    timestamp: DataTypes.BIGINT,
    id: {
        type: DataTypes.INTEGER,
        autoIncrement: true,
        primaryKey: true
    }
}, {timestamps : true});




export const databaseProviders = [{

    provide: "SEQUELIZE",
    useFactory: async () => {
        return sequelize.authenticate()
    .then(result => {
        console.log(`SQLite successfully connected!`);
        return Transaction.sync();
    })
    .then(result => {
        console.log(`Trades table created`);
        return result;
    })
    .catch(error => {
        console.error('Unable to connect to SQLite database:', error);
    })

    },
}];