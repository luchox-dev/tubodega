import { ApiProperty } from '@nestjs/swagger';
import { OrganizationView, UserView } from '../shared/shared.dto.js';

export class MeView {
  @ApiProperty({ type: UserView }) user!: UserView;
  @ApiProperty({ type: OrganizationView }) organization!: OrganizationView;
}
