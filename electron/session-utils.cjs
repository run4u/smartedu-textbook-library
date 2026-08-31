function isCredentialCookie(cookie) {
  const name = String(cookie?.name || '').toUpperCase();
  return name === 'UC_TOKEN' || name.startsWith('UC_TOKEN-') || name === 'UC_SSO_TGC' || name.startsWith('UC_SSO_TGC-');
}

module.exports = { isCredentialCookie };
