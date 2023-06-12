import { initializeWasm } from '@docknetwork/crypto-wasm';
import { checkResult, stringToBytes } from '../../utils';
import {
  BBSSignature,
  CompositeProofG1,
  getAdaptedSignatureParamsForMessages,
  MetaStatements,
  ProofSpecG1,
  Statements,
  Witnesses
} from '../../../src';
import {
  attributes1,
  attributes1Struct,
  attributes2,
  attributes2Struct,
  attributes3,
  attributes3Struct,
  GlobalEncoder
} from './data-and-encoder';
import {
  KeyPair,
  BlindSignature,
  SignatureParams,
  isPS,
  isBBSPlus,
  getWitnessForBlindSigRequest,
  getStatementForBlindSigRequest,
  Scheme,
  adaptKeyForParams
} from '../../scheme';
import { generateRandomG1Element } from '@docknetwork/crypto-wasm';

describe(`${Scheme} Requesting blind signatures`, () => {
  beforeAll(async () => {
    // Load the WASM module
    await initializeWasm();
  });

  it('blind signature', () => {
    // This test check that a user can get signatures from the signer even after hiding some of its messages. The signature
    // generated by the signer is a blind signature as signer could not see all the messages. The user will then unblind the
    // signature to use in proofs

    const label = stringToBytes('Sig params label - this is public');
    // Message count shouldn't matter as `label` is known
    let params = SignatureParams.generate(100, label);
    const keypair = KeyPair.generate(params);
    const h = generateRandomG1Element();
    const sk = keypair.secretKey;
    const pk = keypair.publicKey;

    // The user will hide the "user-id" and "secret" attributes from the signer for the 1st signature
    const hiddenAttrNames1 = new Set<string>();
    hiddenAttrNames1.add('user-id');
    hiddenAttrNames1.add('secret');

    // The user will hide the "user-id" and "secret" attributes from the signer for the 2nd signature
    const hiddenAttrNames2 = new Set<string>();
    hiddenAttrNames2.add('sensitive.user-id');
    hiddenAttrNames2.add('sensitive.secret');

    // The user will hide the "employee-id", "phone" and "secret" attributes from the signer for the 3rd signature
    const hiddenAttrNames3 = new Set<string>();
    hiddenAttrNames3.add('sensitive.employee-id');
    hiddenAttrNames3.add('sensitive.phone');
    hiddenAttrNames3.add('sensitive.very.secret');

    // The attributes known to signer for the 1st signature
    const knownAttributes1 = {
      fname: 'John',
      lname: 'Smith',
      email: 'john.smith@example.com',
      SSN: '123-456789-0',
      country: 'USA',
      city: 'New York',
      timeOfBirth: 1662010849619,
      height: 181.5,
      weight: 210,
      BMI: 23.25,
      score: -13.5
    };

    // The attributes known to signer for the 2nd signature
    const knownAttributes2 = {
      fname: 'John',
      lname: 'Smith',
      sensitive: {
        email: 'john.smith@example.com',
        SSN: '123-456789-0'
      },
      location: {
        country: 'USA',
        city: 'New York'
      },
      timeOfBirth: 1662010849619,
      physical: {
        height: 181.5,
        weight: 210,
        BMI: 23.25
      },
      score: -13.5
    };

    // The attributes known to signer for the 3rd signature
    const knownAttributes3 = {
      fname: 'John',
      lname: 'Smith',
      sensitive: {
        email: 'john.smith@acme.com',
        SSN: '123-456789-0'
      },
      lessSensitive: {
        location: {
          country: 'USA',
          city: 'New York'
        },
        department: {
          name: 'Random',
          location: {
            name: 'Somewhere',
            geo: {
              lat: -23.658,
              long: 2.556
            }
          }
        }
      },
      rank: 6
    };

    for (let [attributes, attributesStruct, hiddenAttrNames, knownAttributes] of [
      [attributes1, attributes1Struct, hiddenAttrNames1, knownAttributes1],
      [attributes2, attributes2Struct, hiddenAttrNames2, knownAttributes2],
      [attributes3, attributes3Struct, hiddenAttrNames3, knownAttributes3]
    ]) {
      hiddenAttrNames = hiddenAttrNames as Set<any>;
      const sigParams = getAdaptedSignatureParamsForMessages(params, attributesStruct);
      const sigPk = adaptKeyForParams(pk, sigParams);
      const sigSk = adaptKeyForParams(sk, sigParams);

      const [names, encodedValues] = GlobalEncoder.encodeMessageObject(attributes);
      const hiddenMsgs = new Map<number, Uint8Array>();
      let found = 0;
      hiddenAttrNames.forEach((n) => {
        const i = names.indexOf(n);
        if (i !== -1) {
          hiddenMsgs.set(i, encodedValues[i]);
          found++;
        }
      });
      if (hiddenAttrNames.size !== found) {
        throw new Error(
          `Some of the hidden message names were not found in the given messages object, ${
            hiddenAttrNames.size - found
          } missing names`
        );
      }

      const blindings = new Map();
      let blinding, request;
      if (isPS()) {
        [blinding, request] = BlindSignature.generateRequest(hiddenMsgs, sigParams, h, blindings);
      } else if (isBBSPlus()) {
        [blinding, request] = BlindSignature.generateRequest(hiddenMsgs, sigParams, false);
      } else {
        request = BlindSignature.generateRequest(hiddenMsgs, sigParams, false);
      }

      const witnesses = new Witnesses(getWitnessForBlindSigRequest(hiddenMsgs, blinding, blindings));

      // The user creates a proof of knowledge of the blinded attributes.
      const proverStatements = new Statements(getStatementForBlindSigRequest(request, sigParams, h));

      const proofSpecProver = new ProofSpecG1(proverStatements, new MetaStatements());
      expect(proofSpecProver.isValid()).toEqual(true);

      const proof = CompositeProofG1.generate(proofSpecProver, witnesses);

      // The signer is the verifier of the user's proof here. Uses the blind signature request to create the statement
      // and proof spec independently.
      const verifierStatements = new Statements(getStatementForBlindSigRequest(request, sigParams, h));

      const proofSpecVerifier = new ProofSpecG1(verifierStatements, new MetaStatements());
      expect(proofSpecVerifier.isValid()).toEqual(true);

      // Signer/verifier verifies the proof
      checkResult(proof.verify(proofSpecVerifier));

      // Signer generates the blind signature using the signature request and attributes known to him. It sends the blind
      // signature to the user
      const blindSignature = BlindSignature.blindSignMessageObject(
        request,
        knownAttributes,
        sigSk,
        attributesStruct,
        isPS() ? h : sigParams,
        GlobalEncoder
      );

      // User unblinds the blind signature
      const revealedSig = isPS()
        ? blindSignature.signature.unblind(blindings, sigPk)
        : isBBSPlus()
        ? blindSignature.signature.unblind(blinding)
        : new BBSSignature(blindSignature.signature.value);

      // The revealed signature can now be used in the usual verification process
      checkResult(revealedSig.verifyMessageObject(attributes, sigPk, sigParams, GlobalEncoder));

      // Proof of knowledge of signature can be created and verified as usual.
    }
  });
});
