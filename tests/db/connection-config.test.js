import { test, expect } from '@jest/globals';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import pg from 'pg';
import { databaseConnectionConfig } from '../../server/db/connection-config.js';

test.each(['localhost', '127.0.0.1', '[::1]', 'helium'])('established local host %s retains plaintext when configured', host => {
  const config = databaseConnectionConfig(`postgres://fixture:synthetic@${host}:5432/fixture?sslmode=disable`);
  expect(config.ssl).toBe(false);
  expect(new pg.Client(config).connectionParameters.ssl).toBe(false);
});
test.each(['remote.example', 'helium.attacker.example', 'localhost.attacker.example', '192.0.2.10'])('remote or lookalike host %s requires verified TLS', host => {
  const config = databaseConnectionConfig(`postgres://fixture:synthetic@${host}/fixture?sslmode=disable`);
  expect(config.ssl.rejectUnauthorized).toBe(true);
  expect(config.connectionString).toBeUndefined();
  expect(new pg.Client(config).connectionParameters.ssl.rejectUnauthorized).toBe(true);
});
test.each(['ssl=no-verify', 'sslmode=no-verify', 'sslmode=require&uselibpqcompat=true', 'sslmode=verify-full', ''])('URL option %s cannot disable remote verification', query => {
  const config = databaseConnectionConfig(`postgres://fixture:synthetic@remote.example/fixture?${query}`);
  expect(config.ssl).toEqual({ rejectUnauthorized: true });
});
test('an explicit local TLS configuration is retained with certificate checks', () => {
  expect(databaseConnectionConfig('postgres://fixture:synthetic@localhost/fixture?sslmode=verify-full').ssl).toEqual({ rejectUnauthorized: true });
});
test('the selector preserves decoded credentials, port and application connection parameters', () => {
  const config = databaseConnectionConfig('postgres://fixture:p%40ss%3Aword@remote.example:5544/fixture?application_name=fixture-test&options=-c%20search_path%3Dpublic');
  expect(config).toMatchObject({ user: 'fixture', password: 'p@ss:word', host: 'remote.example', port: '5544', database: 'fixture', application_name: 'fixture-test', options: '-c search_path=public' });
});
test('URL private CA, certificate and key survive normalization without bypassing hostname verification', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'astra-db-tls-fixture-'));
  try {
    for (const name of ['ca', 'cert', 'key']) fs.writeFileSync(path.join(dir, name), `synthetic ${name} fixture`);
    const url = new URL('postgres://fixture:synthetic@remote.example/fixture');
    for (const [param, name] of [['sslrootcert', 'ca'], ['sslcert', 'cert'], ['sslkey', 'key']]) url.searchParams.set(param, path.join(dir, name));
    url.searchParams.set('sslmode', 'require'); url.searchParams.set('uselibpqcompat', 'true');
    const config = databaseConnectionConfig(url.toString());
    expect(config.ssl).toEqual({ ca: 'synthetic ca fixture', cert: 'synthetic cert fixture', key: 'synthetic key fixture', rejectUnauthorized: true });
    expect(new pg.Client(config).connectionParameters.ssl.checkServerIdentity).toBeUndefined();
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});
test.each(['postgres://fixture:synthetic-secret@%badhost/fixture', 'https://fixture:synthetic-secret@remote.example/fixture', 'postgres://fixture:synthetic-secret@remote.example/fixture?sslrootcert=/absent/private-ca-fixture'])('parse failures expose neither the URL nor its password or private paths', input => {
  let thrown;
  try { databaseConnectionConfig(input); } catch (error) { thrown = error; }
  expect(thrown).toBeInstanceOf(Error);
  expect(thrown.message).not.toContain('synthetic-secret');
  expect(thrown.message).not.toContain(input);
  expect(thrown.message).not.toContain('/absent/');
  expect(thrown.cause).toBeUndefined();
});
test('DATABASE_URL alone selects the target regardless of runtime deployment flags', () => {
  const saved = { url: process.env.DATABASE_URL, deploy: process.env.REPLIT_DEPLOYMENT };
  try {
    process.env.DATABASE_URL = 'postgres://fixture:synthetic@helium/fixture?sslmode=disable';
    process.env.REPLIT_DEPLOYMENT = '1';
    expect(databaseConnectionConfig().host).toBe('helium');
    expect(databaseConnectionConfig().ssl).toBe(false);
    process.env.DATABASE_URL = 'postgres://fixture:synthetic@remote.example/fixture';
    process.env.REPLIT_DEPLOYMENT = '0';
    expect(databaseConnectionConfig().ssl.rejectUnauthorized).toBe(true);
  } finally {
    if (saved.url === undefined) delete process.env.DATABASE_URL; else process.env.DATABASE_URL = saved.url;
    if (saved.deploy === undefined) delete process.env.REPLIT_DEPLOYMENT; else process.env.REPLIT_DEPLOYMENT = saved.deploy;
  }
});
