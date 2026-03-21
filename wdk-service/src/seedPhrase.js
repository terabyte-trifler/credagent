import WDK from '@tetherto/wdk';
import bip39 from 'bip39';

const TWENTY_FOUR_WORD_ENTROPY_BITS = 256;

/**
 * Generate a 24-word BIP-39 seed phrase.
 * WDK's current helper returns 12 words in this environment regardless of input,
 * so we fall back to bip39 to preserve the service's security contract.
 */
export function generate24WordSeedPhrase() {
  const wdkSeed = WDK.getRandomSeedPhrase(24);
  if (typeof wdkSeed === 'string' && wdkSeed.trim().split(/\s+/).length === 24) {
    return wdkSeed.trim();
  }

  return bip39.generateMnemonic(TWENTY_FOUR_WORD_ENTROPY_BITS);
}

export default generate24WordSeedPhrase;
