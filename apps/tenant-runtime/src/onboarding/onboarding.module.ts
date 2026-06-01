import { Module } from '@nestjs/common'
import { OnboardingController } from './onboarding.controller.js'

@Module({ controllers: [OnboardingController] })
export class OnboardingModule {}
