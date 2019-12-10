/* jshint indent: 1 */

module.exports = function(sequelize, DataTypes) {
	return sequelize.define('users', {
		'id': {
			type: DataTypes.STRING,
			allowNull: false,
			primaryKey: true,
			autoIncrement: false,
			comment: null
		},
		'name': {
			type: DataTypes.STRING,
			allowNull: true,
			autoIncrement: false,
			comment: null
		},
		'value': {
			type: DataTypes.FLOAT,
			allowNull: true,
			autoIncrement: false,
			comment: null
		}
	}, {
		tableName: 'users'
	});
};
