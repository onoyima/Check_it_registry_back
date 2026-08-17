// User display name helpers
// Supports both new split name fields (first_name, middle_name, last_name)
// and legacy single 'name' field for backward compatibility

/**
 * Get the full display name from a user object.
 * Prefers first_name/middle_name/last_name if available,
 * falls back to legacy 'name' field.
 *
 * @param {Object} user - User object from database
 * @returns {string} Full display name
 */
function getDisplayName(user) {
  if (!user) return '';

  // Try new split fields first
  const firstName = (user.first_name || '').trim();
  const middleName = (user.middle_name || '').trim();
  const lastName = (user.last_name || '').trim();

  if (firstName) {
    const parts = [firstName];
    if (middleName) parts.push(middleName);
    if (lastName) parts.push(lastName);
    return parts.join(' ');
  }

  // Fallback to legacy 'name' field
  return (user.name || '').trim();
}

/**
 * Get the first name only.
 * @param {Object} user
 * @returns {string}
 */
function getFirstName(user) {
  if (!user) return '';
  if (user.first_name) return user.first_name.trim();
  // Fallback: extract first word from legacy name
  const name = (user.name || '').trim();
  return name.split(' ')[0] || '';
}

/**
 * Build user data object for database INSERT/UPDATE.
 * Accepts either { name } or { first_name, middle_name, last_name }.
 * Always populates both legacy 'name' and new split fields.
 *
 * @param {Object} data - Input data from request body
 * @returns {Object} User data with all name fields populated
 */
function buildUserNameFields(data) {
  const result = {};

  if (data.first_name || data.middle_name || data.last_name) {
    // New split name fields provided
    const firstName = (data.first_name || '').trim();
    const middleName = (data.middle_name || '').trim();
    const lastName = (data.last_name || '').trim();

    result.first_name = firstName || null;
    result.middle_name = middleName || null;
    result.last_name = lastName || null;

    // Build legacy 'name' from parts for backward compatibility
    const parts = [firstName, middleName, lastName].filter(Boolean);
    result.name = parts.length > 0 ? parts.join(' ') : null;
  } else if (data.name) {
    // Legacy single name provided - populate split fields too
    const name = data.name.trim();
    result.name = name;

    const parts = name.split(' ').filter(Boolean);
    result.first_name = parts[0] || null;
    result.middle_name = parts.length > 2 ? parts.slice(1, -1).join(' ') : (parts.length === 2 ? null : null);
    result.last_name = parts.length > 1 ? parts[parts.length - 1] : null;
  }

  return result;
}

/**
 * Build a SELECT clause that includes all name fields.
 * Use this in database queries to ensure we always get the name data.
 *
 * @param {string} tableAlias - Optional table alias (e.g., 'u')
 * @returns {string} SQL column list for name fields
 */
function nameSelectColumns(tableAlias = '') {
  const prefix = tableAlias ? `${tableAlias}.` : '';
  return `${prefix}name, ${prefix}first_name, ${prefix}middle_name, ${prefix}last_name`;
}

module.exports = {
  getDisplayName,
  getFirstName,
  buildUserNameFields,
  nameSelectColumns
};
