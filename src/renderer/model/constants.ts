/**
 * Shared constants: schema id, HTTP methods, raw body languages and the
 * authorization schema that drives both the editor and v2.1 serialization.
 */
import type { ProtocolProfileBehavior } from '../../shared/types';

export const SCHEMA_V21 = 'https://schema.getpostman.com/json/collection/v2.1.0/collection.json';
export const METHODS = Object.freeze(['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD', 'OPTIONS']);
export const RAW_LANGUAGES: ReadonlyArray<readonly [string, string]> = Object.freeze([
  ['text', 'Text'], ['json', 'JSON'], ['javascript', 'JavaScript'], ['html', 'HTML'], ['xml', 'XML']
] as const);
export const RAW_CONTENT_TYPES: Readonly<Record<string, string>> = Object.freeze({
  text: 'text/plain', json: 'application/json', javascript: 'application/javascript', html: 'text/html', xml: 'application/xml'
});
/** Per-request settings stored as v2.1 `protocolProfileBehavior`. */
export const PROTOCOL_SETTINGS: ReadonlyArray<keyof ProtocolProfileBehavior> = Object.freeze([
  'followRedirects', 'followOriginalHttpMethod', 'strictSSL', 'disableCookies', 'disableUrlEncoding', 'maxRedirects'
] as const);

export type AuthInput = 'text' | 'secret' | 'select' | 'textarea' | 'bool';
export type SelectOption = readonly [string, string];

export interface AuthField {
  key: string;
  label: string;
  input?: AuthInput;
  options?: SelectOption[];
  default?: string | boolean;
  advanced?: boolean;
  section?: 'token';
  when?: Record<string, string>;
}

export interface AuthTypeSchema { type: string; label: string; fields: AuthField[] }

const opt = (...pairs: Array<string | SelectOption>): SelectOption[] => pairs.map((p) => (typeof p === 'string' ? [p, p] as const : p));
const text = (key: string, label: string, extra: Partial<AuthField> = {}): AuthField => ({ key, label, ...extra });
const secret = (key: string, label: string, extra: Partial<AuthField> = {}): AuthField => ({ key, label, input: 'secret', ...extra });
const select = (key: string, label: string, options: Array<string | SelectOption>, def: string, extra: Partial<AuthField> = {}): AuthField => ({ key, label, input: 'select', options: opt(...options), default: def, ...extra });
const bool = (key: string, label: string, def: boolean, extra: Partial<AuthField> = {}): AuthField => ({ key, label, input: 'bool', default: def, ...extra });
const textarea = (key: string, label: string, extra: Partial<AuthField> = {}): AuthField => ({ key, label, input: 'textarea', ...extra });
const adv: Partial<AuthField> = { advanced: true };
const token: Partial<AuthField> = { section: 'token' };

export const AUTH_TYPES: AuthTypeSchema[] = [
  { type: 'inherit', label: 'Inherit auth from parent', fields: [] },
  { type: 'noauth', label: 'No Auth', fields: [] },
  { type: 'basic', label: 'Basic Auth', fields: [text('username', 'Username'), secret('password', 'Password')] },
  { type: 'bearer', label: 'Bearer Token', fields: [secret('token', 'Token')] },
  { type: 'apikey', label: 'API Key', fields: [
    text('key', 'Key'), secret('value', 'Value'),
    select('in', 'Add to', [['header', 'Header'], ['query', 'Query Params']], 'header')
  ] },
  { type: 'jwt', label: 'JWT Bearer', fields: [
    select('addTokenTo', 'Add JWT token to', [['header', 'Request Header'], ['queryParam', 'Query Param']], 'header'),
    select('algorithm', 'Algorithm', ['HS256', 'HS384', 'HS512', 'RS256', 'RS384', 'RS512', 'PS256', 'PS384', 'PS512', 'ES256', 'ES384', 'ES512'], 'HS256'),
    textarea('secret', 'Secret / private key'),
    bool('isSecretBase64Encoded', 'Secret Base64 encoded', false),
    textarea('payload', 'Payload (JSON)', { default: '{}' }),
    text('headerPrefix', 'Request header prefix', { default: 'Bearer' }),
    text('queryParamKey', 'Query param name', { default: 'token' }),
    textarea('header', 'JWT headers (JSON)', { default: '{}' })
  ] },
  { type: 'digest', label: 'Digest Auth', fields: [
    text('username', 'Username'), secret('password', 'Password'),
    text('realm', 'Realm', adv), text('nonce', 'Nonce', adv),
    select('algorithm', 'Algorithm', ['MD5', 'MD5-sess', 'SHA-256', 'SHA-256-sess', 'SHA-512-256', 'SHA-512-256-sess'], 'MD5', adv),
    text('qop', 'qop', adv), text('nonceCount', 'Nonce count', adv), text('clientNonce', 'Client nonce', adv), text('opaque', 'Opaque', adv)
  ] },
  { type: 'oauth1', label: 'OAuth 1.0', fields: [
    select('signatureMethod', 'Signature method', ['HMAC-SHA1', 'HMAC-SHA256', 'HMAC-SHA512', 'RSA-SHA1', 'RSA-SHA256', 'RSA-SHA512', 'PLAINTEXT'], 'HMAC-SHA1'),
    text('consumerKey', 'Consumer key'), secret('consumerSecret', 'Consumer secret'),
    text('token', 'Access token'), secret('tokenSecret', 'Token secret'),
    bool('addParamsToHeader', 'Add params to header', true), bool('addEmptyParamsToSign', 'Add empty params to signature', false),
    text('callback', 'Callback URL', adv), text('verifier', 'Verifier', adv), text('timestamp', 'Timestamp', adv), text('nonce', 'Nonce', adv),
    text('version', 'Version', { default: '1.0', ...adv }), text('realm', 'Realm', adv)
  ] },
  { type: 'oauth2', label: 'OAuth 2.0', fields: [
    secret('accessToken', 'Access token'),
    select('addTokenTo', 'Add auth data to', [['header', 'Request Headers'], ['queryParams', 'Request URL']], 'header'),
    text('headerPrefix', 'Header prefix', { default: 'Bearer' }),
    select('grant_type', 'Grant type', [['client_credentials', 'Client Credentials'], ['password_credentials', 'Password Credentials']], 'client_credentials', token),
    text('accessTokenUrl', 'Access token URL', token),
    text('clientId', 'Client ID', token),
    secret('clientSecret', 'Client secret', token),
    text('username', 'Username', { ...token, when: { grant_type: 'password_credentials' } }),
    secret('password', 'Password', { ...token, when: { grant_type: 'password_credentials' } }),
    text('scope', 'Scope', token),
    select('client_authentication', 'Client authentication', [['header', 'Send as Basic Auth header'], ['body', 'Send client credentials in body']], 'header', token)
  ] },
  { type: 'hawk', label: 'Hawk Authentication', fields: [
    text('authId', 'Hawk Auth ID'), secret('authKey', 'Hawk Auth Key'),
    select('algorithm', 'Algorithm', ['sha256', 'sha1'], 'sha256'),
    text('user', 'User', adv), text('nonce', 'Nonce', adv), text('extraData', 'ext', adv), text('app', 'app', adv),
    text('delegation', 'dlg', adv), text('timestamp', 'Timestamp', adv), bool('includePayloadHash', 'Include payload hash', false, adv)
  ] },
  { type: 'awsv4', label: 'AWS Signature', fields: [
    text('accessKey', 'Access key'), secret('secretKey', 'Secret key'),
    text('region', 'AWS region', { default: 'us-east-1' }), text('service', 'Service name'),
    secret('sessionToken', 'Session token', adv), bool('addAuthDataToQuery', 'Add auth data to query', false, adv)
  ] },
  { type: 'ntlm', label: 'NTLM Authentication', fields: [
    text('username', 'Username'), secret('password', 'Password'), text('domain', 'Domain', adv), text('workstation', 'Workstation', adv)
  ] },
  { type: 'edgegrid', label: 'Akamai EdgeGrid', fields: [
    text('accessToken', 'Access token'), text('clientToken', 'Client token'), secret('clientSecret', 'Client secret'),
    text('baseURL', 'Base URL', adv), text('nonce', 'Nonce', adv), text('timestamp', 'Timestamp', adv), text('headersToSign', 'Headers to sign', adv)
  ] },
  { type: 'asap', label: 'ASAP (Atlassian)', fields: [
    select('alg', 'Algorithm', ['RS256', 'RS384', 'RS512', 'PS256', 'PS384', 'PS512', 'ES256', 'ES384', 'ES512'], 'RS256'),
    text('iss', 'Issuer'), text('aud', 'Audience'), text('kid', 'Key ID'),
    textarea('privateKey', 'Private key'),
    text('sub', 'Subject', adv), text('exp', 'Expiry (seconds)', adv),
    textarea('claims', 'Additional claims (JSON)', adv)
  ] }
];

export const AUTH_BY_TYPE: Readonly<Record<string, AuthTypeSchema>> = Object.fromEntries(AUTH_TYPES.map((a) => [a.type, a]));
