/** Thrown by a step to signal "infrastructure not ready — retry without burning an attempt." */
export class TransientProvisioningError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'TransientProvisioningError'
  }
}
