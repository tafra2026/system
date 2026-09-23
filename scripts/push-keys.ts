import webpush from 'web-push'

/**
 * Generate the VAPID key pair for Web Push. Run ONCE per installation and put the values in
 * the server's .env (never in Git). Changing them later forces every device to re-enable.
 */
const { publicKey, privateKey } = webpush.generateVAPIDKeys()
console.log('Add these lines to the server .env file:\n')
console.log(`VAPID_PUBLIC_KEY=${publicKey}`)
console.log(`VAPID_PRIVATE_KEY=${privateKey}`)
console.log('VAPID_SUBJECT=mailto:CHANGE_ME@your-domain')
