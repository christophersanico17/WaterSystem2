// Combines an admin_accounts row's first_name/last_name into one display
// string — used everywhere a single "name" needs to show up (JWT payload,
// audit log, account lists) even though the DB stores them separately.
function fullName({ first_name, last_name } = {}) {
  return [first_name, last_name].filter(Boolean).join(" ").trim();
}

module.exports = { fullName };
