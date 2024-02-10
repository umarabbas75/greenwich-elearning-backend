import { Sequelize } from 'sequelize-typescript';
import * as dotenv from 'dotenv';
import { DataTypes } from "sequelize";
dotenv.config();
if(!process.env?.DB_URL){
    throw new Error("DB_URL is not set");
}
export const sequelize = new Sequelize(process.env.DB_URL, {
    dialect: 'postgres',
    protocol: 'postgres',
    dialectOptions: {
        ssl: {
            require: 'true'
        }
    }
});


export const User = sequelize.define("Users", {
    firstName:  {
        type: DataTypes.STRING,
        allowNull: false,
    },
    lastName:  {
        type: DataTypes.STRING,
        allowNull: false,
    },
    email:  {
        type: DataTypes.STRING,
        allowNull: false,
        unique: true
    },
    phone: DataTypes.TEXT,
    photo: DataTypes.TEXT,
    password:  {
        type: DataTypes.STRING,
        allowNull: false,
    },
    role: DataTypes.ENUM('admin', 'user'),
    timestamp: DataTypes.BIGINT,
    id: {
        type: DataTypes.UUID,
        primaryKey: true,
        defaultValue: DataTypes.UUIDV4 
    }
}, { timestamps: true });

export const Course = sequelize.define("Courses", {
    title: DataTypes.TEXT,
    description: DataTypes.TEXT,

    timestamp: DataTypes.BIGINT,
    id: {
        type: DataTypes.UUID,
        primaryKey: true,
        defaultValue: DataTypes.UUIDV4 
    }
}, { timestamps: true });

// Define Module model
export const Module = sequelize.define('Modules', {
    title: {
        type: DataTypes.STRING,
        allowNull: false,
    },
    description: {
        type: DataTypes.TEXT,
        allowNull: true,
    },
    courseId: {
        type:DataTypes.UUID,
        references: {
            model: "Courses",
            key: 'id'
          }
    }, 

    timestamp: DataTypes.BIGINT,
    id: {
        type: DataTypes.UUID,
        primaryKey: true,
        defaultValue: DataTypes.UUIDV4 
    }
}, { timestamps: true });

// Define Chapter model
export const Chapter = sequelize.define('Chapters', {
    title: {
        type: DataTypes.STRING,
        allowNull: false,
    },
    description: {
        type: DataTypes.TEXT,
        allowNull: true,
    },
    moduleId: {
        type:DataTypes.UUID,
        references: {
            model: "Modules",
            key: 'id'
          }
    }, 
 
    timestamp: DataTypes.BIGINT,
    id: {
        type: DataTypes.UUID,
        primaryKey: true,
        defaultValue: DataTypes.UUIDV4 
    }
}, { timestamps: true });

// Define Section model
export const Section = sequelize.define('Sections', {
    title: {
        type: DataTypes.STRING,
        allowNull: false,
    },
    description: {
        type: DataTypes.TEXT,
        allowNull: true,
    },
    chapterId: {
        type:DataTypes.UUID,
        references: {
            model: "Chapters",
            key: 'id'
          }
    }, 
    timestamp: DataTypes.BIGINT,
    id: {
        type: DataTypes.UUID,
        primaryKey: true,
        defaultValue: DataTypes.UUIDV4 
    }
}, { timestamps: true });

// Define relationships
Course.hasMany(Module,{ foreignKey: 'courseId', as: 'modules' });
Module.belongsTo(Course,{ foreignKey: 'courseId' });

Module.hasMany(Chapter,{ foreignKey: 'moduleId', as: 'chapters' });
Chapter.belongsTo(Module,{ foreignKey: 'moduleId' });

Chapter.hasMany(Section, { foreignKey: 'chapterId', as: 'sections' });
Section.belongsTo(Chapter, { foreignKey: 'chapterId' });

export const databaseProviders = [{

    provide: "SEQUELIZE",
    useFactory: async () => {
        return sequelize.authenticate()
            .then(_ => {
                console.log(`SQLite successfully connected!`);
                sequelize.sync({}).then(() => {
                    console.log('Database and tables created!');
                });
            })
            .catch(error => {
                console.error('Unable to connect to SQLite database:', error);
            })
    },
}];