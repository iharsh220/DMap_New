const { Op } = require('sequelize');

class CrudService {
  constructor(model) {
    this.model = model;
  }

  // Create a new record
  async create(data) {
    try {
      const record = await this.model.create(data);
      return {
        success: true,
        data: record,
        message: 'Record created successfully'
      };
    } catch (error) {
      console.error('Error creating record:', error);
      return {
        success: false,
        error: error.message,
        message: 'Failed to create record'
      };
    }
  }

  // Get all records with optional filtering, pagination, and sorting
  async getAll(options = {}) {
    try {
      const {
        where = {},
        include = [],
        limit,
        offset,
        order = [['created_at', 'DESC']],
        attributes,
        paranoid = true
      } = options;

      const records = await this.model.findAll({
        where,
        include,
        limit,
        offset,
        order,
        attributes,
        paranoid
      });

      return {
        success: true,
        data: records,
        message: 'Records retrieved successfully'
      };
    } catch (error) {
      console.error('Error retrieving records:', error);
      return {
        success: false,
        error: error.message,
        message: 'Failed to retrieve records'
      };
    }
  }

  // Get a single record by ID
  async getById(id, options = {}) {
    try {
      const {
        include = [],
        attributes,
        paranoid = true
      } = options;

      const record = await this.model.findByPk(id, {
        include,
        attributes,
        paranoid
      });

      if (!record) {
        return {
          success: false,
          error: 'Record not found',
          message: 'Record not found'
        };
      }

      return {
        success: true,
        data: record,
        message: 'Record retrieved successfully'
      };
    } catch (error) {
      console.error('Error retrieving record:', error);
      return {
        success: false,
        error: error.message,
        message: 'Failed to retrieve record'
      };
    }
  }

  // Update a record by ID
  async updateById(id, data, options = {}) {
    try {
      const { paranoid = true } = options;

      const [affectedRows] = await this.model.update(data, {
        where: { id },
        paranoid
      });

      if (affectedRows === 0) {
        return {
          success: false,
          error: 'Record not found or no changes made',
          message: 'Record not found or no changes made'
        };
      }

      // Get the updated record
      const updatedRecord = await this.model.findByPk(id, { paranoid });

      return {
        success: true,
        data: updatedRecord,
        message: 'Record updated successfully'
      };
    } catch (error) {
      console.error('Error updating record:', error);
      return {
        success: false,
        error: error.message,
        message: 'Failed to update record'
      };
    }
  }

  // Delete a record by ID (soft delete if paranoid is enabled)
  async deleteById(id, options = {}) {
    try {
      const { force = false, paranoid = true } = options;

      const record = await this.model.findByPk(id, { paranoid });

      if (!record) {
        return {
          success: false,
          error: 'Record not found',
          message: 'Record not found'
        };
      }

      if (force) {
        await record.destroy({ force: true });
      } else {
        await record.destroy();
      }

      return {
        success: true,
        message: 'Record deleted successfully'
      };
    } catch (error) {
      console.error('Error deleting record:', error);
      return {
        success: false,
        error: error.message,
        message: 'Failed to delete record'
      };
    }
  }

  // Restore a soft-deleted record
  async restoreById(id) {
    try {
      const record = await this.model.findByPk(id, { paranoid: false });

      if (!record) {
        return {
          success: false,
          error: 'Record not found',
          message: 'Record not found'
        };
      }

      if (!record.deleted_at) {
        return {
          success: false,
          error: 'Record is not deleted',
          message: 'Record is not deleted'
        };
      }

      await record.restore();

      return {
        success: true,
        data: record,
        message: 'Record restored successfully'
      };
    } catch (error) {
      console.error('Error restoring record:', error);
      return {
        success: false,
        error: error.message,
        message: 'Failed to restore record'
      };
    }
  }

  // Search records with advanced filtering
  async search(options = {}) {
    try {
      const {
        searchFields = [],
        searchTerm = '',
        where = {},
        include = [],
        limit,
        offset,
        order = [['created_at', 'DESC']],
        attributes,
        paranoid = true
      } = options;

      let searchWhere = { ...where };

      if (searchTerm && searchFields.length > 0) {
        searchWhere[Op.or] = searchFields.map(field => ({
          [field]: { [Op.like]: `%${searchTerm}%` }
        }));
      }

      const records = await this.model.findAll({
        where: searchWhere,
        include,
        limit,
        offset,
        order,
        attributes,
        paranoid
      });

      return {
        success: true,
        data: records,
        message: 'Search completed successfully'
      };
    } catch (error) {
      console.error('Error searching records:', error);
      return {
        success: false,
        error: error.message,
        message: 'Search failed'
      };
    }
  }

  // Count records with optional filtering
  async count(options = {}) {
    try {
      const { where = {}, paranoid = true } = options;

      const count = await this.model.count({
        where,
        paranoid
      });

      return {
        success: true,
        data: count,
        message: 'Count retrieved successfully'
      };
    } catch (error) {
      console.error('Error counting records:', error);
      return {
        success: false,
        error: error.message,
        message: 'Failed to count records'
      };
    }
  }

  // Bulk create records
  async bulkCreate(dataArray) {
    try {
      const records = await this.model.bulkCreate(dataArray);
      return {
        success: true,
        data: records,
        message: 'Records created successfully'
      };
    } catch (error) {
      console.error('Error bulk creating records:', error);
      return {
        success: false,
        error: error.message,
        message: 'Failed to create records'
      };
    }
  }

  // Bulk update records
  async bulkUpdate(updates) {
    try {
      const results = [];
      for (const update of updates) {
        const { id, data } = update;
        const result = await this.updateById(id, data);
        results.push(result);
      }

      return {
        success: true,
        data: results,
        message: 'Bulk update completed'
      };
    } catch (error) {
      console.error('Error bulk updating records:', error);
      return {
        success: false,
        error: error.message,
        message: 'Bulk update failed'
      };
    }
  }

  // Check if record exists
  async exists(where) {
    try {
      const count = await this.model.count({ where });
      return {
        success: true,
        data: count > 0,
        message: 'Existence check completed'
      };
    } catch (error) {
      console.error('Error checking existence:', error);
      return {
        success: false,
        error: error.message,
        message: 'Failed to check existence'
      };
    }
  }
}

module.exports = CrudService;