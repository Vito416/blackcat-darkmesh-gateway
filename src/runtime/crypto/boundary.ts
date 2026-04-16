export type RuntimeCryptoBoundaryEvidence = Readonly<{
  mode: 'verification-only'
  requestPathSigning: false
  walletSigning: false
  privateKeySigning: false
  verificationHelpers: readonly string[]
  forbiddenCapabilities: readonly string[]
}>

export const runtimeCryptoBoundaryEvidence: RuntimeCryptoBoundaryEvidence = Object.freeze({
  mode: 'verification-only',
  requestPathSigning: false,
  walletSigning: false,
  privateKeySigning: false,
  verificationHelpers: Object.freeze([
    'safeCompareAscii',
    'safeCompareHexOrAscii',
    'verifyHmacSignature',
    'normalizeSignatureRefList',
    'validateSignatureRefList',
    'validateExpectedSignatureRefs',
    'signatureRefListsOverlap',
  ]),
  forbiddenCapabilities: Object.freeze([
    'wallet signing',
    'private-key signing',
    'request-path key derivation',
    'request-path signing',
  ]),
})

export function getRuntimeCryptoBoundaryEvidence(): RuntimeCryptoBoundaryEvidence {
  return runtimeCryptoBoundaryEvidence
}
