// Stand-in for Prembly during tests: a small register of people (by NIN)
// and companies (by CAC number). Counts every call so tests can prove each
// number is looked up only once.
const IdentityService = require('../../services/IdentityService');

const people = new Map();
const companies = new Map();
const calls = [];

function install() {
  IdentityService.providerLookup = async (kind, number) => {
    calls.push({ kind, number });
    if (kind === 'nin') {
      const p = people.get(number);
      if (!p) throw new Error('Prembly NIN verification failed: NIN not found');
      return { provider: 'prembly', nin: number, middle_name: '', date_of_birth: '1990-01-01', gender: 'F', ...p };
    }
    const c = companies.get(number.replace(/^(RC|BN|IT)/, '')) || companies.get(number);
    if (!c) throw new Error('Prembly CAC failed: record not found');
    return { provider: 'prembly', rc_number: number, status: 'ACTIVE', registration_date: '2015-03-01', address: 'Lagos', directors: [], ...c };
  };
}

let seq = 0;
// A fresh, valid-looking NIN for a person with these names
function addPerson(first_name, last_name, extra = {}) {
  const nin = ('7' + String(Date.now()).slice(-7) + String(100 + (seq++ % 900))).slice(0, 11);
  people.set(nin, { first_name, last_name, ...extra });
  return nin;
}
function addCompany(company_name, extra = {}) {
  const rc = String(1000000 + Math.floor(Math.random() * 8999999));
  companies.set(rc, { company_name, ...extra });
  return rc;
}
const callsFor = (number) => calls.filter((c) => c.number.endsWith(String(number))).length;

module.exports = { install, addPerson, addCompany, calls, callsFor, people, companies };
