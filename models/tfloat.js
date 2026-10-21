/* jshint indent: 1 */
module.exports = function(sequelize, DataTypes) {
return sequelize.define('tfloat', {
'id': {
type: DataTypes.STRING,
allowNull: false,
primaryKey: true,
autoIncrement: false,
comment: null
},
'd': {
type: DataTypes.DATE,
allowNull: true,
autoIncrement: false,
comment: null
}
}, {
tableName: 'tfloat'
});
};
