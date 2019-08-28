const fs = require('fs');
const path = require('path');
const soap = require('soap');
const forge = require('node-forge');

/**
 * Software Development Kit for AFIP web services
 * 
 * This release of Afip SDK is intended to facilitate 
 * the integration to other different web services that 
 * Electronic Billing   
 * 
 * @link http://www.afip.gob.ar/ws/ AFIP Web Services documentation
 * 
 * @author 	Afip SDK afipsdk@gmail.com
 * @package Afip
 * @version 0.6
 **/
module.exports = Afip;

function Afip(options){

	/**
	 * File name for the WSDL corresponding to WSAA
	 *
	 * @var string
	 **/
	this.WSAA_WSDL;

	/**
	 * The url to get WSAA token
	 *
	 * @var string
	 **/
	this.WSAA_URL;

	/**
	 * File name for the X.509 certificate in PEM format
	 *
	 * @var string
	 **/
	this.CERT;

	/**
	 * File name for the private key correspoding to CERT (PEM)
	 *
	 * @var string
	 **/
	this.PRIVATEKEY;

	/**
	 * The passphrase (if any) to sign
	 *
	 * @var string
	 **/
	this.PASSPHRASE;

	/**
	 * Afip resources folder
	 *
	 * @var string
	 **/
	this.RES_FOLDER;

	/**
	 * The CUIT to use
	 *
	 * @var int
	 **/
	this.CUIT;

	/**
	 * Implemented Web Services
	 *
	 * @var array[string]
	 **/
	this.implemented_ws = [
		'ElectronicBilling',
		'RegisterScopeFour',
		'RegisterScopeFive',
		'RegisterScopeTen'
	];

	if (!(this instanceof Afip)) {return new Afip(options)}

	options = options || {};	

	if (!options.hasOwnProperty('CUIT')) {throw new Error("CUIT field is required in options array");}
	else{this.CUIT = options['CUIT'];}
	if (!options.hasOwnProperty('production')) {options['production'] = false;}
	if (!options.hasOwnProperty('passphrase')) {options['passphrase'] = 'xxxxx';}
	if (!options.hasOwnProperty('cert')) {options['cert'] = 'cert';}
	if (!options.hasOwnProperty('key')) {options['key'] = 'key';}

	this.options = options;


	this.RES_FOLDER = __dirname+'/Afip_res/';
	this.CERT 		= path.resolve(this.RES_FOLDER, options['cert']);
	this.PRIVATEKEY = path.resolve(this.RES_FOLDER, options['key']);
	this.WSAA_WSDL 	= this.RES_FOLDER+'wsaa.wsdl';

	if (options['production'] === true) {
		this.WSAA_URL = 'https://wsaa.afip.gov.ar/ws/services/LoginCms';
	}
	else{
		this.WSAA_URL = 'https://wsaahomo.afip.gov.ar/ws/services/LoginCms';
	}

	var self = this;

	for (var i = 0; i < this.implemented_ws.length; i++) {
		defile_ws_getter(this.implemented_ws[i]);
	}

	function defile_ws_getter(ws) {
		Object.defineProperty(self, ws, {
			enumerable: true, 
			configurable: false,
			get : () => { 
				if (self['__'+ws+'__']) {
					return self['__'+ws+'__'];
				}
				else{
					try{
						var WSClass = require (__dirname+'/Class/'+ws+'.js');
					}
					catch(e){
						throw new Error('File '+__dirname+'/Class/'+ws+'.js is required');
					}

					return self['__'+ws+'__'] = new WSClass(self);
				}
			}
		});
	}
}

/**
 * Gets token authorization for an AFIP Web Service
 *
 * @since 0.1
 *
 * @param string service Service for token authorization
 * @param function(error,ta) callback
 **/
Afip.prototype.GetServiceTA = function(service, callback, recreate)
{
	recreate = recreate === false ? false : true;
	var ta_file = this.RES_FOLDER+'TA-'+this.options['CUIT']+'-'+service+'.json';

	fs.access(ta_file, fs.constants.F_OK, (err) => {
		if (!err) {
			var ta_data 		= require(ta_file),
				actual_time 	= new Date(Date.now()+600000),
				expiration_time = new Date(ta_data.header[1].expirationtime);

			if (actual_time < expiration_time) {
				callback(null,{
					token : ta_data.credentials.token,
					sign : ta_data.credentials.sign
				});
				return;
			}
			else if (recreate === false){
				callback('Error getting Token Autorization');
				return;
			}
		}

		this.CreateServiceTA(service)
		.then(()=>{this.GetServiceTA(service, callback, false);})
		.catch((err)=>{callback('Error getting Token Autorization '+err)})
	});
}

/**
 * Create an TA from WSAA
 *
 * Request to WSAA for a tokent authorization for service and save this
 * in a xml file
 *
 * @since 0.1
 *
 * @param string service 	Service for token authorization
 *
 * @return Promise 
 **/
Afip.prototype.CreateServiceTA = function(service)
{
	return new Promise((resolve,reject)=>{
		// Create TRA
		var date 	= new Date(),
			tra 	= '<?xml version="1.0" encoding="UTF-8" ?><loginTicketRequest version="1.0"><header><uniqueId>{uniqueId}</uniqueId><generationTime>{generationTime}</generationTime><expirationTime>{expirationTime}</expirationTime></header><service>{service}</service></loginTicketRequest>';

		tra = tra.replace('{uniqueId}', Math.floor(date.getTime()/1000));
		tra = tra.replace('{generationTime}', new Date(date.getTime()-600000).toISOString());
		tra = tra.replace('{expirationTime}', new Date(date.getTime()+600000).toISOString());
		tra = tra.replace('{service}', service);
		tra = tra.trim();
		
		// Get cert
		const certPromise = new Promise((resolve, reject) => {
			fs.readFile(this.CERT, { encoding:'utf8' }, (err, data) => err ? reject(err) : resolve(data));
		});
			
		// Get key
		const keyPromise = new Promise((resolve, reject) => {
			fs.readFile(this.PRIVATEKEY, { encoding:'utf8' }, (err, data) => err ? reject(err) : resolve(data));
		});

		// Sign TRA
		Promise.all([certPromise, keyPromise]).then(([cert, key]) => {
			const p7 = forge.pkcs7.createSignedData();
			p7.content = forge.util.createBuffer(tra, "utf8");
			p7.addCertificate(cert);
			p7.addSigner({
				authenticatedAttributes: [{
					type: forge.pki.oids.contentType,
					value: forge.pki.oids.data,
				}, 
				{
					type: forge.pki.oids.messageDigest
				}, 
				{
					type: forge.pki.oids.signingTime, 
					value: new Date()
				}],
				certificate: cert,
				digestAlgorithm: forge.pki.oids.sha256,
				key: key,
			});
			
			p7.sign();

			const bytes = forge.asn1.toDer(p7.toAsn1()).getBytes();
			
			return Buffer.from(bytes, "binary").toString("base64");
		})
		.then((result)=> {
			var args = {in0: result},
				options = {disableCache:true, returnFault:true};

			// Create SOAP client
			soap.createClient(this.WSAA_WSDL, options,(err, client)=> {
				if (err) {reject(err);return;}

				// Request Token
				client.loginCms(args,(err, result)=> {
					if (err) {reject(err);return;}

					var parseString = require('xml2js').parseString;

					parseString(result.loginCmsReturn, {
						normalizeTags: true,
						normalize: true,
						explicitArray: false,
						attrkey: 'header',
						tagNameProcessors: [(key) => { return key.replace('soapenv:', ''); }]
					}, (err, res) => {
						if (err) {reject(err);return;}

						var fs = require('fs');
						// Save Token data in json file						
						fs.writeFile(this.RES_FOLDER+'TA-'+this.options['CUIT']+'-'+service+'.json', JSON.stringify(res.loginticketresponse), (err) => {
							if (err) {reject(err);return;}
							resolve(true)
						});
					});
				});
			});

		})
		.catch(function (err) {reject(err)});
	});
}