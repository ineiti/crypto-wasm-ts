import {
  generateCompositeProofG1,
  generateCompositeProofG1WithDeconstructedProofSpec,
  getAllKeyedSubproofsFromProof,
  saverGetCiphertextFromProof,
  saverGetCiphertextsFromProof,
  verifyCompositeProofG1,
  verifyCompositeProofG1WithDeconstructedProofSpec,
  VerifyResult
} from 'crypto-wasm-new';
import {
  verifyCompositeProofG1 as verifyCompositeProofG1Old,
  verifyCompositeProofG1WithDeconstructedProofSpec as verifyCompositeProofG1WithDeconstructedProofSpecOld
} from 'crypto-wasm-old';
import {
  BDDT16KeyedProof,
  KBUniAccumMembershipKeyedProof,
  KBUniAccumNonMembershipKeyedProof,
  VBAccumMembershipKeyedProof
} from '../keyed-proofs';
import { MetaStatements, Statements } from './statement';
import { Witnesses } from './witness';
import { SetupParam } from './setup-param';
import { SaverCiphertext } from '../saver';
import { ProofSpec, QuasiProofSpec } from './proof-spec';
import { BytearrayWrapper } from '../bytearray-wrapper';

/**
 * A proof of 1 or more statements and meta statements.
 */
export class CompositeProof extends BytearrayWrapper {
  /**
   * Generate the composite proof using a `ProofSpec`
   * @param proofSpec
   * @param witnesses
   * @param nonce
   */
  static generate(proofSpec: ProofSpec, witnesses: Witnesses, nonce?: Uint8Array): CompositeProof {
    const proof = generateCompositeProofG1(proofSpec.value, witnesses.values, nonce);
    return new CompositeProof(proof);
  }

  /**
   * Generate the composite proof using a `QuasiProofSpecG1`
   * @param proofSpec
   * @param witnesses
   * @param nonce
   */
  static generateUsingQuasiProofSpec(
    proofSpec: QuasiProofSpec,
    witnesses: Witnesses,
    nonce?: Uint8Array
  ): CompositeProof {
    return CompositeProof.generateWithDeconstructedProofSpec(
      proofSpec.statements,
      proofSpec.metaStatements,
      witnesses,
      proofSpec.setupParams,
      proofSpec.context,
      nonce
    );
  }

  /**
   * Verify this composite proof using a `ProofSpec`
   * @param proofSpec
   * @param nonce
   * @param useNewVersion - Whether to use the new version of the wasm library
   */
  verify(proofSpec: ProofSpec, nonce?: Uint8Array, useNewVersion = true): VerifyResult {
    return useNewVersion
      ? verifyCompositeProofG1(this.value, proofSpec.value, nonce)
      : verifyCompositeProofG1Old(this.value, proofSpec.value, nonce);
  }

  /**
   * Verify this composite proof using a `QuasiProofSpecG1`
   * @param proofSpec
   * @param nonce
   * @param useNewVersion - Whether to use the new version of the wasm library
   */
  verifyUsingQuasiProofSpec(proofSpec: QuasiProofSpec, nonce?: Uint8Array, useNewVersion = true): VerifyResult {
    return this.verifyWithDeconstructedProofSpec(
      proofSpec.statements,
      proofSpec.metaStatements,
      proofSpec.setupParams,
      proofSpec.context,
      nonce,
      useNewVersion
    );
  }

  /**
   * Get the ciphertext for the SAVER statement at index `statementIndex`. The proof involving any SAVER statement also
   * contains the ciphertext corresponding to that statement. Will throw an error if it could not find the ciphertext or
   * statement at that index
   * @param statementIndex
   */
  getSaverCiphertext(statementIndex: number): SaverCiphertext {
    return new SaverCiphertext(saverGetCiphertextFromProof(this.value, statementIndex));
  }

  getSaverCiphertexts(statementIndices: number[]): SaverCiphertext[] {
    const cts = saverGetCiphertextsFromProof(this.value, statementIndices);
    return cts.map((ct) => new SaverCiphertext(ct));
  }

  static generateWithDeconstructedProofSpec(
    statements: Statements,
    metaStatements: MetaStatements,
    witnesses: Witnesses,
    setupParams?: SetupParam[],
    context?: Uint8Array,
    nonce?: Uint8Array
  ): CompositeProof {
    const params = (setupParams ?? new Array<SetupParam>()).map((s) => s.value);
    const proof = generateCompositeProofG1WithDeconstructedProofSpec(
      statements.values,
      metaStatements.values,
      params,
      witnesses.values,
      context,
      nonce
    );
    return new CompositeProof(proof);
  }

  verifyWithDeconstructedProofSpec(
    statements: Statements,
    metaStatements: MetaStatements,
    setupParams?: SetupParam[],
    context?: Uint8Array,
    nonce?: Uint8Array,
    useNewVersion = true
  ): VerifyResult {
    const params = (setupParams ?? new Array<SetupParam>()).map((s) => s.value);
    return useNewVersion
      ? verifyCompositeProofG1WithDeconstructedProofSpec(
          this.value,
          statements.values,
          metaStatements.values,
          params,
          context,
          nonce
        )
      : verifyCompositeProofG1WithDeconstructedProofSpecOld(
          this.value,
          statements.values,
          metaStatements.values,
          params,
          context,
          nonce
        );
  }

  /**
   * Get keyed proofs from a composite proof.
   * @returns - The key in the returned map is the statement index
   */
  getKeyedProofs(): Map<
    number,
    | BDDT16KeyedProof
    | VBAccumMembershipKeyedProof
    | KBUniAccumMembershipKeyedProof
    | KBUniAccumNonMembershipKeyedProof
  > {
    const r = new Map<
      number,
      | BDDT16KeyedProof
      | VBAccumMembershipKeyedProof
      | KBUniAccumMembershipKeyedProof
      | KBUniAccumNonMembershipKeyedProof
    >();
    const delgProofs = getAllKeyedSubproofsFromProof(this.value);
    for (const [i, [t, v]] of delgProofs.entries()) {
      let cls;
      if (t === 0) {
        cls = BDDT16KeyedProof;
      } else if (t === 1) {
        cls = VBAccumMembershipKeyedProof;
      } else if (t === 2) {
        cls = KBUniAccumMembershipKeyedProof;
      } else if (t === 3) {
        cls = KBUniAccumNonMembershipKeyedProof;
      } else {
        throw new Error(`Unknown type ${t} of keyed proof for credential index ${i}`);
      }
      r.set(i, new cls(v));
    }
    return r;
  }
}
