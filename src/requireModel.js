function requireModel(fn, sequelize, DataTypes) {
    return require(fn)(sequelize, DataTypes)
}

module.exports = requireModel
