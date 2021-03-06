
import UummContract from '../build/contracts/Uumm.json'
import Config from '../truffle-config.js'
import Web3AutoSetup from './Web3AutoSetup.js'
import Web3 from 'web3'
import State from './State.js'

const gasEstimates=
{
    VoteProposal:80000
}

const estimatedGasMultipler = 1.2

class UummContractInterface
{
    //"User" makes reference to the current app user

    constructor()
    {
        this.contractInstance = {}
        this.init()
        this.isReadyPromise = new Promise((resolve, reject)=>
        {
            this.resolveIsReady = resolve
            this.rejectIsReady = reject
        })
        this.web3= new Web3()//This is only used for utility funcitons
    }

    //resolves or rejects this.setupFinished promise
    init=()=>
    {
        var {host, port} = Config.networks[process.env.NODE_ENV]


        var localNodeProvider = 'http://' + host + ':' + port
        var infuraProvider = "https://ropsten.infura.io/rcj7IaE4gGAHIlV4pND6"

        var providersList = []
        providersList.push("*")
        providersList.push(localNodeProvider)
        providersList.push(infuraProvider)

        Web3AutoSetup.setup(providersList)
        .then(()=>{
            const contract = require('truffle-contract')
            const uummContract = contract(UummContract)

            this.provider = Web3AutoSetup.getProvider()

            uummContract.setProvider(this.provider)

            uummContract.deployed()
            .then((instance)=>{
                this.contractInstance = instance
                this.resolveIsReady()
            }).catch((error)=>{
                this.rejectIsReady(error)})

        }).catch((error)=>{
            this.rejectIsReady(error)
        })   
    }

    isReady=()=>
    {
        return this.isReadyPromise
    }

    createProposal=(projectId, title, reference="", valueAmount)=>
    {
        var unconfirmedProposal = State.addUnconfirmedProposal(projectId, title)

        return new Promise((resolve, reject)=>
        {
            this.contractInstance.CreateProposal.estimateGas(projectId, title, reference, valueAmount)
            .then((estimatedGas)=>{
                estimatedGas=Math.round(estimatedGas*estimatedGasMultipler)
                return this.contractInstance.CreateProposal(projectId, title, reference, valueAmount, {from: Web3AutoSetup.currentAccount, gas:estimatedGas})
            }).then((result)=> {

                this.getProposals(projectId).then(()=>
                {   
                    this.checkTransactionReceipt(result)
                    State.deleteUnconfirmedProposal(projectId, unconfirmedProposal)
                    resolve()
                }).catch((error)=>{reject(error)})

            }).catch((error)=>{
                State.deleteUnconfirmedProposal(projectId, unconfirmedProposal)
                reject(error)
            })
        })
    }

    createProject=(projectName)=>
    {
        return new Promise((resolve, reject)=>
        {
            var unconfirmedProjectId = State.addUnconfirmedProject(projectName)

            this.contractInstance.CreateProject.estimateGas(projectName)
            .then((estimatedGas)=>{
                estimatedGas=Math.round(estimatedGas*estimatedGasMultipler)
                return this.contractInstance.CreateProject(projectName, {from: Web3AutoSetup.currentAccount, gas:estimatedGas})
            }).then((result)=> {
                this.checkTransactionReceipt(result)
                this.getUserProjects().then(()=>{
                    State.deleteUnconfirmedProject(unconfirmedProjectId)
                    resolve()
                }).catch((error)=>{reject(error)})

            }).catch((error)=>{
                State.deleteUnconfirmedProject(unconfirmedProjectId)
                reject(error)
            })
        })
    }

    getUserProjects=()=>
    {     
        var that = this
        return new Promise((resolve, reject)=>
        {
            var array = []
            var loadedCount = 0

            if(!Web3AutoSetup.currentAccount)
                reject("No valid address")

            that.contractInstance.GetProjectsLength.call(Web3AutoSetup.currentAccount)
            .then((numberOfProjects)=>
            {
                for(var i=0; i<numberOfProjects.toNumber(); i++)
                {
                    that.contractInstance.GetProjectIdByIndex.call(Web3AutoSetup.currentAccount, i)
                    .then((projectId)=>
                    {
                        State.addUserProjectRef(Web3AutoSetup.currentAccount, projectId)

                        that.getProjectDetails(projectId)
                        .then((details)=>
                        {
                            array.push(details)
                            loadedCount ++
                            if(loadedCount===numberOfProjects.toNumber())
                                resolve(array)
                        }).catch((error)=>{reject(error)})
                    }).catch((error)=>{reject(error)})
                }
            
            }).catch((error)=>{reject(error)})
        })
    }

    getProjectDetails=(projectId)=>
    {
        return new Promise( (resolve, reject)=>
        {
            if(!projectId)
                reject("projectId is not valid")
            this.contractInstance.GetProjectDetails.call(projectId)
            .then((details)=>
            {
                var projectDetails = State.getEmptyProject()

                projectDetails.creator = details[0]
                projectDetails.name = details[1]
                projectDetails.id = details[2]
                projectDetails.creationDate = new Date (details[3].toNumber()*1000)
                projectDetails.totalSupply=details[4].toNumber()
                projectDetails.requiredConcensus=details[5].toNumber()/100
                projectDetails.requiredParticipation=details[6].toNumber()/100

                State.addProject(projectId, projectDetails)

                resolve(projectDetails)

            }).catch(function(error){reject(error)})
        })         
    }

    getContributorDataByAddress=(projectId, contributorAddress)=>
    {
        return new Promise((resolve, reject)=>
        {
            //TODO: better validation
            if(!projectId)
                reject("projectId is not valid")
            if(!contributorAddress)
                reject("Invalid contributorAddress")

           this.contractInstance.GetContributorDataByAddress.call(projectId, contributorAddress)
            .then((details)=>
            {
                var contributorData = {
                    'id' : details[0].toNumber(),
                    'contributorAddress' : details[1],
                    'name' : details[2],
                    'valueTokens' : details[3].toNumber(),
                    'etherBalance': details[4].toNumber()
                }

                var project = {}
                project.contributors={}
                project.contributors[contributorData.contributorAddress]=contributorData

                State.addProject(projectId, project)

                resolve(contributorData)

            }).catch(function(error){reject(error)})
        })       
    }

    getContributors = (projectId) =>
    {
        return new Promise((resolve, reject)=>
        {
            this.contractInstance.GetContributorsLength.call(projectId)
            .then((numberOfContributors)=>
            {
                //TODO: record number of proposals so we don't need to reload them all
                //TODO: only load pending proposals, since are the only ones that can change
                var contributorsAmount = numberOfContributors.toNumber()

                var loadedAmount = 0
                for(var contributorIndex=0; contributorIndex<contributorsAmount; contributorIndex++)
                {
                    this.getContributorData(projectId, contributorIndex).then(()=>{
                        loadedAmount++
                        if (loadedAmount === contributorsAmount)
                            resolve()
                    })  
                }
            })
        })  
    }

    getContributorData = (projectId, contributorIndex)=>
    {
        return new Promise((resolve, reject)=>
        {
            if(!projectId)
                reject("projectId is not valid")

           this.contractInstance.GetContributorData.call(projectId, contributorIndex)
            .then((details)=>
            {
                var contributorData = {
                    'id' : details[0].toNumber(),
                    'contributorAddress' : details[1],
                    'name' : details[2],
                    'valueTokens' : details[3].toNumber(),
                    'etherBalance': this.web3.fromWei(details[4].toNumber(), "ether")
                }

                var project = {}
                project.contributors={}
                project.contributors[contributorData.contributorAddress]=contributorData

                State.addProject(projectId, project)

                resolve(contributorData)

            }).catch(function(error){reject(error)})
        }) 
    }

    getUserContributorData = (projectId)=>
    {
        if(Web3AutoSetup.currentAccount)
            return this.getContributorDataByAddress(projectId, Web3AutoSetup.currentAccount)
    }

    getProposals = (projectId) =>
    {
        return new Promise((resolve, reject)=>
        {
            this.contractInstance.GetProposalsLength.call(projectId)
            .then((numberOfProposals)=>
            {
                //TODO: record number of proposals so we don't need to reload them all
                //TODO: only load pending proposals, since are the only ones that can change
                var propoalsAmount = numberOfProposals.toNumber()
                var loadedAmount = 0
                for(var proposalId=0; proposalId<propoalsAmount; proposalId++)
                {
                    this.getProposal(projectId, proposalId).then(()=>{
                        loadedAmount++
                        if (loadedAmount === propoalsAmount)
                            resolve()
                    })  
                }
            })
        })  
    }

    getProposal = (projectId, proposalId) =>
    {
        return new Promise((resolve, reject)=>
        {
            if(!projectId || isNaN(proposalId))
                reject("projectId or proposalId are not valid")

            var proposalData = State.getEmptyProposal()

            this.contractInstance.GetProposalDetails.call(projectId, proposalId)
            .then((proposalDetails)=>
            {
                proposalData.id = proposalDetails[0].toNumber()
                proposalData.author = proposalDetails[1]
                proposalData.title = proposalDetails[2]
                proposalData.reference = proposalDetails[3]
                proposalData.valueAmount = proposalDetails[4].toNumber()
                proposalData.creationDate = new Date (proposalDetails[5].toNumber()*1000)
                
                this.contractInstance.GetProposalState.call(projectId, proposalId)
                .then((proposalState)=>
                {
                    proposalData.id = proposalState[0].toNumber()
                    proposalData.state = proposalState[1].toNumber()
                    proposalData.positiveVotes = proposalState[2].toNumber()
                    proposalData.negativeVotes = proposalState[3].toNumber()
                    proposalData.creationDate = new Date (proposalState[4].toNumber()*1000)
                    proposalData.totalSupply = proposalState[5].toNumber()
                
                    var project = {}
                    project.proposals = {}
                    project.proposals[proposalId] = proposalData

                    State.addProject(projectId, project)

                    if(Web3AutoSetup.currentAccount)
                        this.getContributorVote(projectId, proposalId, Web3AutoSetup.currentAccount)

                    resolve();

                }).catch((error)=>{console.error(error)})
            })
        })  
    }

    voteProposal=(projectId, proposalId, vote)=>
    {
        State.setProposalInProgress(projectId, proposalId)
        return new Promise((resolve, reject)=>
        {
            this.contractInstance.VoteProposal.estimateGas(projectId, proposalId, vote)
            .then((estimatedGas)=>{

                let estimateVoteProposalGas = Math.round(estimatedGas*estimatedGasMultipler)
                if(estimateVoteProposalGas>100000)
                    estimateVoteProposalGas = gasEstimates.VoteProposal

                return this.contractInstance.VoteProposal(projectId, proposalId, vote, {from: Web3AutoSetup.currentAccount, gas:estimateVoteProposalGas})
            }).then((result)=> {
                resolve()
                this.getProposals(projectId)
                this.getProjectDetails(projectId)
                this.getUserContributorData(projectId)
            }).catch((error)=>{console.error(error)})
        })
    }

    resolveProposal=( projectId,  proposalId)=>
    {
        State.setProposalInProgress(projectId, proposalId)
        return new Promise((resolve, reject)=>
        {
            this.contractInstance.ResolveProposal.estimateGas(projectId, proposalId)
            .then((estimatedGas)=>{
                estimatedGas=Math.round(estimatedGas*estimatedGasMultipler)
                return this.contractInstance.ResolveProposal(projectId, proposalId, {from: Web3AutoSetup.currentAccount, gas:estimatedGas})
            }).then((result)=> {
                resolve()
                this.getProposals(projectId)
                this.getProjectDetails(projectId)
                this.getUserContributorData(projectId)
            }).catch((error)=>{console.error(error)})
        })
    }

    getContributorVote = (projectId, proposalId, contributorAddress)=>
    {
        return new Promise((resolve, reject)=>
        {
            this.contractInstance.GetContributorVote(projectId, proposalId, contributorAddress).then((vote)=>{

                var project = {}
                project.proposals = {}
                project.proposals[proposalId] = {}
                project.proposals[proposalId].votes = {}
                project.proposals[proposalId].votes[contributorAddress]=vote.toNumber()

                State.addProject(projectId, project)

                resolve()
            }) 
        })  
    }

    checkTransactionReceipt=(result)=>
    {
        if(result.receipt.gasUsed === result.receipt.cumulativeGasUsed)
            console.error("Transaction may had run out of gas: gasUsed = cumulativeGasUsed = "+result.receipt.gasUsed)
    }

}

const instance = new UummContractInterface();
export default instance;