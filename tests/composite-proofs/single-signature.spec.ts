import { initializeWasm } from '@docknetwork/crypto-wasm';
import { stringToBytes } from '../utils';
import {
  CompositeProofG1,
  MetaStatements,
  ProofSpecG1,
  Statements,
  Witnesses
} from '../../src';
import {
  KeyPair,
  Signature,
  SignatureParams,
  buildStatement,
  buildWitness,
} from '../scheme'
import { encodeMessageForSigning } from '@docknetwork/crypto-wasm';

describe('Proving knowledge of 1 signature over the attributes', () => {
  it('works', async () => {
    // Load the WASM module
    await initializeWasm();

    // Messages to sign; the messages are attributes of a user like SSN (Social Security Number), name, email, etc
    const messages: Uint8Array[] = [];
    // SSN
    messages.push(encodeMessageForSigning(stringToBytes('123-456789-0')));
    // First name
    messages.push(encodeMessageForSigning(stringToBytes('John')));
    // Last name
    messages.push(encodeMessageForSigning(stringToBytes('Smith')));
    // Email
    messages.push(encodeMessageForSigning(stringToBytes('john.smith@emample.com')));
    // City
    messages.push(encodeMessageForSigning(stringToBytes('New York')));

    const messageCount = messages.length;

    const label = stringToBytes('My sig params in g1');
    const params = SignatureParams.generate(messageCount, label);

    // Signers keys
    const keypair = KeyPair.generate(params);
    const sk = keypair.secretKey;
    const pk = keypair.publicKey;

    // Signer knows all the messages and signs
    const sig = Signature.generate(messages, sk, params, false);
    const result = sig.verify(messages, pk, params, false);
    expect(result.verified).toEqual(true);

    // User reveals 2 messages at index 2 and 4 to verifier, last name and city
    const revealedMsgIndices: Set<number> = new Set();
    revealedMsgIndices.add(2);
    revealedMsgIndices.add(4);
    const revealedMsgs: Map<number, Uint8Array> = new Map();
    const unrevealedMsgs: Map<number, Uint8Array> = new Map();
    for (let i = 0; i < messageCount; i++) {
      if (revealedMsgIndices.has(i)) {
        revealedMsgs.set(i, messages[i]);
      } else {
        unrevealedMsgs.set(i, messages[i]);
      }
    }

    const statement1 = buildStatement(params, pk, revealedMsgs, false);
    const statements = new Statements(statement1);

    // Optional context of the proof
    const context = stringToBytes('some context');

    // Both the prover (user) and verifier should independently construct this `ProofSpec` but only for testing, i am reusing it.
    const proofSpec = new ProofSpecG1(statements, new MetaStatements(), [], context);
    expect(proofSpec.isValid()).toEqual(true);

    const witness1 = buildWitness(sig, unrevealedMsgs, false);
    const witnesses = new Witnesses(witness1);

    const nonce = stringToBytes('some unique nonce');

    const proof = CompositeProofG1.generate(proofSpec, witnesses, nonce);

    expect(proof.verify(proofSpec, nonce).verified).toEqual(true);
  });
});