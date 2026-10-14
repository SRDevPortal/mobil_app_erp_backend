const test = require('node:test');
const assert = require('node:assert/strict');
const { buildStartupDecision } = require('../src/services/startupDecision');

test('new user without a profile must complete setup', () => {
  const result = buildStartupDecision({ user: { name: 'new-user' } });
  assert.equal(result.should_open, 'profile_setup');
  assert.equal(result.force_profile_setup, true);
  assert.equal(result.profile_complete, false);
});

test('incomplete profiles require setup even when the force flag is missing or false', () => {
  for (const force of [undefined, false, 0, '0']) {
    assert.equal(buildStartupDecision({ profile: { profile_complete: 0, force_profile_setup: force } }).should_open, 'profile_setup');
  }
});

test('completed profile returns to dashboard across supported response shapes', () => {
  for (const complete of [true, 1, '1', 'true']) {
    for (const data of [{profile: {profile_complete: complete}}, {profiles: [{profile_complete: complete}]}, {user: {profiles: [{profile_complete: complete}]}}]) {
      const result = buildStartupDecision(data);
      assert.equal(result.should_open, 'dashboard');
      assert.equal(result.force_profile_setup, false);
    }
  }
});
