import { Injectable } from '@nestjs/common';
import {Transaction} from "./database/database.providers"
import { ResponseDto,BodyDto } from './dto';

@Injectable()
export class AppService {
  async getTxDetails(address:string): Promise<ResponseDto> {
    let allTx = await Transaction.findAll({where:{address}});
    return {msg:"Successfully save Transaction data",status:"success",data:allTx}
  }
  async saveTxData(body:BodyDto):Promise<ResponseDto> {
     await Transaction.create({
      investment: body.investment,
      address: body.address,
      transactionHash: body.transactionHash,
      timestamp: Date.now(),
    })
    return {msg:"Successfully save Transaction data",status:"success",data:{}}
  }
}
