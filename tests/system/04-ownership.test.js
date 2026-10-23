// Proof of ownership: category-specific proof, admin approval and rejection,
// claims and dispute decisions.
const { api, auth, state, Database, registerItem, confirmItem, expectStatus, makeImei, makeSerial, makeVin, PNG, outbox } = require('./helpers');

const sendProof = (who, deviceId, type, note) => {
  const r = api().post(`/api/ownership/device/${deviceId}/proof`).set(auth(who)).field('proof_type', type);
  if (note) r.field('note', note);
  return r.attach('proof_document', PNG, { filename: 'proof.png', contentType: 'image/png' });
};

describe('proof of ownership', () => {
  test('each kind of item asks for suitable proof', async () => {
    const keys = async (c) => (await api().get(`/api/ownership/proof-types?category=${c}`).set(auth('user'))).body.types.map((t) => t.key);
    expect(await keys('smartphone')).toContain('imei_screen');
    expect(await keys('laptop')).toContain('serial_label');
    expect(await keys('vehicle')).toEqual(expect.arrayContaining(['vehicle_licence', 'customs_papers', 'vin_photo']));
    expect(await keys('jewelry')).toContain('appraisal_certificate');
  });

  test('send proof → admin approves → verified owner', async () => {
    const d = await registerItem('user', { category: 'smartphone', brand: 'Samsung', model: 'S25', imei: makeImei() });
    expectStatus(await sendProof('user', d.id, 'vehicle_licence'), 400); // wrong kind for a phone
    expectStatus(await sendProof('user', d.id, 'other'), 400);          // "other" needs a note
    const sent = expectStatus(await sendProof('user', d.id, 'receipt'), 201);
    expect(sent.body.level).toBe('proof_submitted');

    const queue = expectStatus(await api().get('/api/ownership/admin/proofs').set(auth('admin')), 200);
    const item = queue.body.proofs.find((p) => p.device_id === d.id);
    expect(item).toBeTruthy();
    // the admin can open the uploaded file; another user cannot
    const file = item.file_url.replace('/uploads/', '/api/files/view/');
    expectStatus(await api().get(file).set(auth('admin')), 200);
    expectStatus(await api().get(file).set(auth('user2')), 403, 404);

    outbox.clear();
    expectStatus(await api().post(`/api/ownership/admin/proofs/${item.id}/review`).set(auth('admin')).send({ decision: 'approve' }), 200);
    const own = expectStatus(await api().get(`/api/ownership/device/${d.id}`).set(auth('user')), 200);
    expect(own.body.level).toBe('verified_owner');
    expect(outbox.messages.some((m) => /verified/i.test(m.subject))).toBe(true);
  });

  test('a rejection needs a reason and the owner sees it', async () => {
    const d = await registerItem('user', { category: 'laptop', brand: 'HP', model: 'Envy', serial: makeSerial() });
    expectStatus(await sendProof('user', d.id, 'serial_label'), 201);
    const item = (await api().get('/api/ownership/admin/proofs').set(auth('admin'))).body.proofs.find((p) => p.device_id === d.id);
    expectStatus(await api().post(`/api/ownership/admin/proofs/${item.id}/review`).set(auth('admin')).send({ decision: 'reject' }), 400);
    expectStatus(await api().post(`/api/ownership/admin/proofs/${item.id}/review`).set(auth('admin')).send({ decision: 'reject', note: 'Photo is unclear' }), 200);
    const own = (await api().get(`/api/ownership/device/${d.id}`).set(auth('user'))).body;
    expect(own.level).toBe('registered');
    expect(own.proofs[0].review_note).toBe('Photo is unclear');
  });

  test('a registration proof goes straight into the review queue', async () => {
    const up = expectStatus(await api().post('/api/files/upload/proof').set(auth('user')).attach('proof_document', PNG, { filename: 'r.png', contentType: 'image/png' }), 200);
    const d = await registerItem('user', { category: 'laptop', brand: 'Dell', model: 'Latitude', serial: makeSerial(), proof_url: up.body.file.url, proof_type: 'receipt' });
    const own = (await api().get(`/api/ownership/device/${d.id}`).set(auth('user'))).body;
    expect(own.level).toBe('proof_submitted');
  });

  test('claim → disputed → admin gives the item to the claimant', async () => {
    const vin = makeVin();
    const d = await registerItem('user', { category: 'vehicle', brand: 'Honda', model: 'Accord', vin });
    await confirmItem('user', d.id);
    const look = expectStatus(await api().get(`/api/ownership/claims/lookup?identifier=${vin}`).set(auth('user2')), 200);
    expect(look.body.user_id).toBeUndefined();
    expect(look.body.proofTypes.map((t) => t.key)).toContain('vehicle_licence');

    const claim = (body) => api().post('/api/ownership/claims').set(auth('user2'))
      .field('identifier', vin).field('statement', body.statement).field('proof_type', body.type)
      .attach('proof_document', PNG, { filename: 'c.png', contentType: 'image/png' });
    expectStatus(await claim({ statement: 'mine', type: 'vehicle_licence' }), 400);
    outbox.clear();
    expectStatus(await claim({ statement: 'I bought this car in 2021 and it was stolen in Ikeja last month.', type: 'vehicle_licence' }), 201);
    expect(outbox.messages.some((m) => m.to === state().users.user.email && /claimed/i.test(m.subject))).toBe(true);

    // while disputed it cannot be sold or transferred
    expectStatus(await api().post('/api/marketplace').set(auth('user')).send({ device_id: d.id, title: 'Car', price: 5000000 }), 400);
    const t = await api().post('/api/device-transfer/initiate').set(auth('user')).send({ deviceId: d.id, buyerEmail: state().users.user2.email });
    expect(t.status).toBe(400);

    const disputes = expectStatus(await api().get('/api/ownership/admin/disputes').set(auth('admin')), 200);
    const dispute = disputes.body.disputes.find((x) => x.device_id === d.id);
    expect(dispute.proofs.some((p) => p.side === 'claimant')).toBe(true);
    expectStatus(await api().post(`/api/ownership/admin/disputes/${dispute.id}/resolve`).set(auth('admin')).send({ decision: 'claimant' }), 400);
    expectStatus(await api().post(`/api/ownership/admin/disputes/${dispute.id}/resolve`).set(auth('admin')).send({ decision: 'claimant', note: 'Licence matches the claimant' }), 200);
    const [row] = await Database.query('SELECT user_id, ownership_level FROM devices WHERE id = ?', [d.id]);
    expect(row.user_id).toBe(state().users.user2.id);
    expect(row.ownership_level).toBe('verified_owner');
    const mine = (await api().get('/api/ownership/claims/mine').set(auth('user2'))).body.claims;
    expect(mine.some((c) => c.status === 'awarded_claimant')).toBe(true);
  });
});
