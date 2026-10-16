/* jshint indent: 1 */
module.exports = function(sequelize, DataTypes) {
return sequelize.define('tcond', {
'id': {
type: DataTypes.STRING,
allowNull: false,
primaryKey: true,
autoIncrement: false,
comment: null
},
's': {
type: DataTypes.STRING,
allowNull: true,
autoIncrement: false,
comment: null
},
't': {
type: DataTypes.TEXT,
allowNull: true,
autoIncrement: false,
comment: null
},
'i': {
type: DataTypes.INTEGER,
allowNull: true,
autoIncrement: false,
comment: null
},
'f': {
type: DataTypes.FLOAT,
allowNull: true,
autoIncrement: false,
comment: null
},
'p': {
type: DataTypes.DOUBLE,
allowNull: true,
autoIncrement: false,
comment: null
},
'dec': {
type: DataTypes.DECIMAL(10, 2),
allowNull: true,
autoIncrement: false,
comment: null
},
'b': {
type: DataTypes.BOOLEAN,
allowNull: true,
autoIncrement: false,
comment: null
},
'd': {
type: DataTypes.DATE,
allowNull: true,
autoIncrement: false,
comment: null
},
'length': {
type: DataTypes.INTEGER,
allowNull: true,
autoIncrement: false,
comment: null
},
'p$x': {
type: DataTypes.STRING,
allowNull: true,
autoIncrement: false,
comment: null
}
}, {
tableName: 'tcond'
});
};