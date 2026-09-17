/**
 * Auto-generate a password from a person's name following the project rule:
 *   [firstName][lastName]salahaddin   (lowercase, no spaces)
 *
 * Example: ('John', 'Doe Smith') -> 'johndoesmithsalahaddin'
 */
function generatePassword(firstName, lastName) {
  const clean = (s) => String(s || '').toLowerCase().replace(/\s+/g, '');
  return `${clean(firstName)}${clean(lastName)}salahaddin`;
}

module.exports = generatePassword;
