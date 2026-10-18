import type { Catalog } from '../..';

export const auth: Catalog['errors']['auth'] = {
  invalidCredentials: 'Adresa de email sau parola nu este corectă.',
  accountLocked:
    'Contul tău e blocat temporar după prea multe încercări nereușite de autentificare. Încearcă din nou peste {minutes, plural, one {# minut} few {# minute} other {# de minute}}.',
  accountDeactivated: 'Acest cont a fost dezactivat.',
  accountScheduledForDeletion:
    'Acest cont este programat pentru ștergere pe {date}. Îl mai poți păstra.',
  noPasswordToChange:
    'Te autentifici cu Google sau Facebook, așa că nu ai o parolă de schimbat.',
  currentPasswordIncorrect: 'Parola actuală nu este corectă.',
  samePassword: 'Parola nouă trebuie să fie diferită de cea actuală.',
  passwordChanged:
    'Parola ta a fost schimbată. Te rugăm să te autentifici din nou.',
  resetLinkInvalid:
    'Linkul de resetare a parolei nu mai este valid. Cere unul nou.',
  verificationLinkInvalid:
    'Linkul de verificare a adresei de email nu mai este valid. Cere unul nou.',
  providerUnavailable:
    'Autentificarea cu {provider} nu este disponibilă momentan.',
  providerSignInFailed:
    'Nu te-am putut autentifica cu {provider}. Încearcă din nou.',
  providerNoEmail:
    '{provider} nu ne-a trimis adresa ta de email, iar fără ea nu te putem autentifica.',
};
