const {v4:uuidv4}=require('uuid');
function createPixCharge({amount,description}){const gatewayRef=`pix_${uuidv4()}`;return{gatewayRef,status:'pendente',pixCopiaCola:`00020126MOCKPIX${gatewayRef}5204000053039865802BR5913CORE TICKETS6009SAO PAULO62070503***6304MOCK`,amount,description};}
function createCardCharge({amount,description,cardToken}){return{gatewayRef:`card_${uuidv4()}`,status:'pendente',amount,description,cardToken:cardToken||'mock-token'};}
function simulateConfirmation(){return{status:'confirmado',confirmedAt:new Date().toISOString()};}
module.exports={createPixCharge,createCardCharge,simulateConfirmation};
