import { IsEmail, IsString, Matches, MaxLength, MinLength } from 'class-validator'

export class SignupDto {
  @IsString()
  @MinLength(2)
  @MaxLength(100)
  companyName!: string

  @IsString()
  @Matches(/^[a-z0-9][a-z0-9-]{1,28}[a-z0-9]$/, {
    message: 'slug must be 3–30 lowercase alphanumeric characters/hyphens with no leading or trailing hyphen',
  })
  slug!: string

  @IsEmail({}, { message: 'adminEmail must be a valid email address' })
  adminEmail!: string
}
